"""
Runs router — execute evaluation runs and retrieve history.

Endpoints:
  POST  /runs/                      trigger a new eval run
  GET   /runs/                      list all runs (with optional suite filter)
  GET   /runs/{run_id}              get a run + all its results + statistics
  GET   /runs/compare/{a}/{b}       diff two runs with statistical comparison
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlmodel import Session, select
from app.database import get_session
from app.models.schema import (
    Run, RunCreate, RunRead,
    Result, ResultRead,
    TestCase, Suite,
)
from app.services.llm_providers import run_inference
from app.services.scoring import score_result
from app.services.stats import mcnemar_test, wilson_ci, run_statistics
from datetime import datetime
import json

router = APIRouter()


# ── Trigger a run ──────────────────────────────────────────────────────────────

@router.post("/", response_model=RunRead)
async def create_run(
    run_in: RunCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """
    Creates a Run record immediately (status=pending) and executes
    the evaluation in the background so the HTTP response is instant.
    Poll GET /runs/{id} to track progress.
    """
    suite = session.get(Suite, run_in.suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")

    run = Run.model_validate(run_in)
    run.status = "pending"
    session.add(run)
    session.commit()
    session.refresh(run)

    background_tasks.add_task(_execute_run, run.id)
    return run


async def _execute_run(run_id: int):
    from app.database import engine
    from sqlmodel import Session

    with Session(engine) as session:
        run = session.get(Run, run_id)
        if not run:
            return

        try:
            run.status = "running"
            session.add(run)
            session.commit()

            suite = session.get(Suite, run.suite_id)
            test_cases = session.exec(
                select(TestCase).where(TestCase.suite_id == run.suite_id)
            ).all()

            prompt_config = suite.prompt_config
            system_prompt = prompt_config.get("system_prompt", "You are a helpful assistant.")
            temperature = run.run_config.get("temperature", prompt_config.get("temperature", 0.7))
            max_tokens = run.run_config.get("max_tokens", prompt_config.get("max_tokens", 512))
            user_template = prompt_config.get("user_template", "{input}")

            passed_count = 0
            total_latency = 0.0

            for tc in test_cases:
                print(f"  Processing test case {tc.id}...")
                try:
                    user_message = user_template.format(**tc.input_data)
                except KeyError:
                    user_message = json.dumps(tc.input_data)

                model_id = tc.model_override or run.model_id

                try:
                    inference_result = await run_inference(
                        provider=run.provider,
                        model_id=model_id,
                        system_prompt=system_prompt,
                        user_message=user_message,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    actual_output = inference_result.output
                    latency_ms = inference_result.latency_ms
                    raw = inference_result.raw
                    print(f"  ✓ Inference complete: {actual_output[:50]!r}")
                except Exception as e:
                    print(f"  ✗ Inference failed: {e}")
                    actual_output = f"[inference error] {e}"
                    latency_ms = 0.0
                    raw = {"error": str(e)}
                    result = Result(
                        run_id=run.id,
                        test_case_id=tc.id,
                        actual_output=actual_output,
                        latency_ms=latency_ms,
                        raw_response=raw,
                        passed=False,
                        reason=f"Inference failed: {e}",
                        strict_passed=None,
                        normalised_passed=None,
                        llm_passed=None,
                    )
                    session.add(result)
                    total_latency += latency_ms
                    continue

                scores = await score_result(
                    actual=actual_output,
                    expected=tc.expected_output,
                    check_strict_flag=tc.check_strict,
                    check_normalised_flag=tc.check_normalised,
                    check_llm_flag=tc.check_llm,
                )
                print(f"  ✓ Scored: passed={scores['passed']}")

                result = Result(
                    run_id=run.id,
                    test_case_id=tc.id,
                    actual_output=actual_output,
                    latency_ms=latency_ms,
                    raw_response=raw,
                    **scores,
                )
                session.add(result)

                if scores["passed"]:
                    passed_count += 1
                total_latency += latency_ms

            n = len(test_cases)
            run.total_cases = n
            run.passed = passed_count
            run.failed = n - passed_count
            run.pass_rate = round(passed_count / n, 4) if n > 0 else 0.0
            run.avg_latency_ms = round(total_latency / n, 2) if n > 0 else 0.0
            run.completed_at = datetime.utcnow()
            run.status = "complete"
            session.add(run)
            session.commit()
            print(f"Run {run_id} complete: {passed_count}/{n} passed")

        except Exception as e:
            print(f"Run {run_id} FAILED with exception: {e}")
            import traceback
            traceback.print_exc()
            run.status = "error"
            run.completed_at = datetime.utcnow()
            session.add(run)
            session.commit()

# ── Retrieve runs ──────────────────────────────────────────────────────────────

@router.get("/", response_model=list[RunRead])
def list_runs(
    suite_id: int | None = None,
    session: Session = Depends(get_session)
):
    query = select(Run).order_by(Run.started_at.desc())
    if suite_id:
        query = query.where(Run.suite_id == suite_id)
    return session.exec(query).all()


@router.get("/{run_id}", response_model=dict)
def get_run(run_id: int, session: Session = Depends(get_session)):
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    results = session.exec(
        select(Result).where(Result.run_id == run_id)
    ).all()
    return {
        "run": RunRead.model_validate(run),
        "statistics": run_statistics(run.passed, run.total_cases),
        "results": [ResultRead.model_validate(r) for r in results],
    }


# ── Compare two runs ───────────────────────────────────────────────────────────

@router.get("/compare/{run_a_id}/{run_b_id}")
def compare_runs(
    run_a_id: int,
    run_b_id: int,
    session: Session = Depends(get_session)
):
    """
    Side-by-side diff of two runs on the same suite.
    Returns per-test-case change classification plus statistical comparison.

    Change types:
      fixed      — was failing, now passing
      regressed  — was passing, now failing
      unchanged  — same result in both runs
      added      — only in run B
      removed    — only in run A
    
    Statistical test: McNemar's test on paired pass/fail outcomes.
    Requires at least 10 discordant pairs for reliable results.
    """
    run_a = session.get(Run, run_a_id)
    run_b = session.get(Run, run_b_id)

    if not run_a or not run_b:
        raise HTTPException(status_code=404, detail="One or both runs not found")
    if run_a.suite_id != run_b.suite_id:
        raise HTTPException(
            status_code=400,
            detail="Runs must be from the same suite to compare"
        )

    results_a = {r.test_case_id: r for r in session.exec(
        select(Result).where(Result.run_id == run_a_id)
    ).all()}
    results_b = {r.test_case_id: r for r in session.exec(
        select(Result).where(Result.run_id == run_b_id)
    ).all()}

    all_case_ids = set(results_a.keys()) | set(results_b.keys())
    diff = []

    for case_id in sorted(all_case_ids):
        tc = session.get(TestCase, case_id)
        ra = results_a.get(case_id)
        rb = results_b.get(case_id)
        status_a = ra.passed if ra else None
        status_b = rb.passed if rb else None

        if status_a is None:
            change = "added"
        elif status_b is None:
            change = "removed"
        elif status_a == status_b:
            change = "unchanged"
        elif not status_a and status_b:
            change = "fixed"
        else:
            change = "regressed"

        diff.append({
            "test_case_id": case_id,
            "test_case_name": tc.name if tc else None,
            "change": change,
            "run_a": {
                "passed": status_a,
                "actual_output": ra.actual_output if ra else None,
                "reason": ra.reason if ra else None,
                "latency_ms": ra.latency_ms if ra else None,
            },
            "run_b": {
                "passed": status_b,
                "actual_output": rb.actual_output if rb else None,
                "reason": rb.reason if rb else None,
                "latency_ms": rb.latency_ms if rb else None,
            },
        })

    regressions = sum(1 for d in diff if d["change"] == "regressed")
    fixes = sum(1 for d in diff if d["change"] == "fixed")

    results_a_bool = [
        d["run_a"]["passed"] for d in diff
        if d["run_a"]["passed"] is not None
    ]
    results_b_bool = [
        d["run_b"]["passed"] for d in diff
        if d["run_b"]["passed"] is not None
    ]

    return {
        "run_a": RunRead.model_validate(run_a),
        "run_b": RunRead.model_validate(run_b),
        "summary": {
            "regressions": regressions,
            "fixes": fixes,
            "unchanged": sum(1 for d in diff if d["change"] == "unchanged"),
            "ci_a": wilson_ci(run_a.passed, run_a.total_cases),
            "ci_b": wilson_ci(run_b.passed, run_b.total_cases),
            "statistical_test": mcnemar_test(results_a_bool, results_b_bool),
        },
        "diff": diff,
    }