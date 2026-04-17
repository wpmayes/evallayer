"""
Runs router — create and inspect evaluation runs.

Endpoints:
  POST   /runs                        create a run (fires async worker)
  GET    /runs/                       list runs (optional ?suite_id=)
  GET    /runs/{run_id}               get run + results + statistics
  GET    /runs/compare/{a}/{b}        McNemar diff between two runs

Key async fixes applied
───────────────────────
1. create_run is now `async def` so asyncio.create_task() is always called
   from within a running event loop — previously it was a sync route and the
   task could be silently dropped.

2. _execute_run uses asyncio.to_thread() for every SQLite/SQLModel call so
   the synchronous DB driver never blocks the event loop.  All inference and
   scoring work remains fully async.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from datetime import datetime
import asyncio
import json

from app.database import get_session, engine
from app.models.schema import (
    Run, RunCreate, RunRead,
    Result, ResultRead,
    TestCase, Suite,
)

from app.services.llm_providers import run_inference
from app.services.scoring import score_result
from app.services.stats import run_statistics


router = APIRouter()

CONCURRENCY_LIMIT = 5


# ─────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────

@router.post("", response_model=RunRead)
async def create_run(run_in: RunCreate, session: Session = Depends(get_session)):
    """
    Create a run record immediately, then fire-and-forget the async worker.

    IMPORTANT: this must be `async def` so that asyncio.create_task() is
    always invoked from inside the running event loop that FastAPI manages.
    Calling create_task() from a plain sync route is undefined behaviour and
    will silently drop the task on some ASGI servers.
    """
    suite = session.get(Suite, run_in.suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")

    run = Run.model_validate(run_in)
    run.status = "pending"
    session.add(run)
    session.commit()
    session.refresh(run)

    asyncio.create_task(_execute_run(run.id))

    return run


@router.get("/", response_model=list[RunRead])
def list_runs(
    suite_id: int | None = None,
    session: Session = Depends(get_session),
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


@router.get("/compare/{run_a_id}/{run_b_id}")
def compare_runs(
    run_a_id: int,
    run_b_id: int,
    session: Session = Depends(get_session),
):
    run_a = session.get(Run, run_a_id)
    run_b = session.get(Run, run_b_id)

    if not run_a or not run_b:
        raise HTTPException(status_code=404, detail="Run not found")

    if run_a.suite_id != run_b.suite_id:
        raise HTTPException(status_code=400, detail="Runs must be from the same suite")

    results_a = {
        r.test_case_id: r
        for r in session.exec(select(Result).where(Result.run_id == run_a_id)).all()
    }
    results_b = {
        r.test_case_id: r
        for r in session.exec(select(Result).where(Result.run_id == run_b_id)).all()
    }

    diff = []
    for case_id in sorted(set(results_a) | set(results_b)):
        ra = results_a.get(case_id)
        rb = results_b.get(case_id)

        if ra is None:
            change = "added"
        elif rb is None:
            change = "removed"
        elif ra.passed == rb.passed:
            change = "unchanged"
        elif not ra.passed and rb.passed:
            change = "fixed"
        else:
            change = "regressed"

        tc = session.get(TestCase, case_id)
        diff.append({
            "test_case_id": case_id,
            "test_case_name": tc.name if tc else None,
            "change": change,
            "run_a": ra.passed if ra else None,
            "run_b": rb.passed if rb else None,
        })

    return {
        "run_a": run_a_id,
        "run_b": run_b_id,
        "diff": diff,
        "summary": {
            "regressions": sum(d["change"] == "regressed" for d in diff),
            "fixes": sum(d["change"] == "fixed" for d in diff),
        },
    }


# ─────────────────────────────────────────────────────────────
# BACKGROUND WORKER
# ─────────────────────────────────────────────────────────────

async def _execute_run(run_id: int) -> None:
    """
    Executes a full evaluation run in the background.

    All SQLModel/SQLite calls are wrapped in asyncio.to_thread() so the
    synchronous DB driver never blocks the event loop.  Inference and scoring
    remain fully async and are fanned-out with asyncio.gather() + a semaphore
    to cap concurrency at CONCURRENCY_LIMIT simultaneous LLM calls.
    """
    semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

    # ── 1. Load initial state from DB (blocking → thread) ─────────────────────
    def _load():
        with Session(engine) as s:
            run = s.get(Run, run_id)
            if run is None:
                return None, None, []
            run.status = "running"
            s.add(run)
            s.commit()
            s.refresh(run)

            suite = s.get(Suite, run.suite_id)
            cases = s.exec(
                select(TestCase).where(TestCase.suite_id == run.suite_id)
            ).all()

            # Detach: pull the data we need out before the session closes
            run_snapshot = {
                "id": run.id,
                "suite_id": run.suite_id,
                "model_id": run.model_id,
                "provider": run.provider,
                "run_config": dict(run.run_config or {}),
            }
            suite_prompt_config = dict(suite.prompt_config or {}) if suite else {}
            cases_snapshot = [
                {
                    "id": tc.id,
                    "input_data": dict(tc.input_data or {}),
                    "expected_output": tc.expected_output,
                    "check_strict": tc.check_strict,
                    "check_normalised": tc.check_normalised,
                    "check_llm": tc.check_llm,
                    "model_override": tc.model_override,
                }
                for tc in cases
            ]
            return run_snapshot, suite_prompt_config, cases_snapshot

    run_data, prompt_config, test_cases = await asyncio.to_thread(_load)
    if run_data is None:
        return

    # ── 2. Fan-out: run all test cases concurrently ────────────────────────────
    async def process_case(tc: dict) -> Result:
        async with semaphore:
            try:
                user_template = prompt_config.get("user_template", "{input}")
                try:
                    user_message = user_template.format(**tc["input_data"])
                except Exception:
                    user_message = json.dumps(tc["input_data"])

                inference = await run_inference(
                    provider=run_data["provider"],
                    model_id=tc["model_override"] or run_data["model_id"],
                    system_prompt=prompt_config.get(
                        "system_prompt", "You are a helpful assistant."
                    ),
                    user_message=user_message,
                    temperature=run_data["run_config"].get("temperature", 0.7),
                    max_tokens=run_data["run_config"].get("max_tokens", 512),
                )

                scores = await score_result(
                    actual=inference.output,
                    expected=tc["expected_output"],
                    check_strict_flag=tc["check_strict"],
                    check_normalised_flag=tc["check_normalised"],
                    check_llm_flag=tc["check_llm"],
                )

                return Result(
                    run_id=run_data["id"],
                    test_case_id=tc["id"],
                    actual_output=inference.output,
                    latency_ms=inference.latency_ms,
                    raw_response=inference.raw,
                    **scores,
                )

            except Exception as exc:
                return Result(
                    run_id=run_data["id"],
                    test_case_id=tc["id"],
                    actual_output=str(exc),
                    passed=False,
                    latency_ms=0.0,
                    raw_response={"error": str(exc)},
                    reason=str(exc),
                )

    results: list[Result] = await asyncio.gather(
        *(process_case(tc) for tc in test_cases)
    )

    # ── 3. Persist results and finalise run (blocking → thread) ───────────────
    def _save(results: list[Result], status: str = "complete"):
        with Session(engine) as s:
            for r in results:
                s.add(r)

            passed = sum(1 for r in results if r.passed)
            n = len(results)
            total_latency = sum(r.latency_ms for r in results)

            run = s.get(Run, run_id)
            if run:
                run.total_cases = n
                run.passed = passed
                run.failed = n - passed
                run.pass_rate = passed / n if n else 0.0
                run.avg_latency_ms = total_latency / n if n else 0.0
                run.completed_at = datetime.utcnow()
                run.status = status
                s.add(run)

            s.commit()
            print(f"[RUN {'COMPLETE' if status == 'complete' else 'FAILED'}] "
                  f"{run_id} → {passed}/{n}")

    try:
        await asyncio.to_thread(_save, results)
    except Exception as exc:
        print(f"[RUN SAVE ERROR] {run_id}: {exc}")

        def _mark_error():
            with Session(engine) as s:
                run = s.get(Run, run_id)
                if run:
                    run.status = "error"
                    run.completed_at = datetime.utcnow()
                    s.add(run)
                    s.commit()

        await asyncio.to_thread(_mark_error)