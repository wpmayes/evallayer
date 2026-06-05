"""
Evaluator service — the core fan-out loop shared by the web worker and the CLI.

This is deliberately free of any FastAPI, SQLModel, or database concerns. It
takes plain dicts in and returns plain dicts out, so both the background run
worker (which persists results to SQLite) and the standalone CLI (which prints
them and writes a JSON report) call exactly the same code path. Keeping the
evaluation logic in one place means UI runs and CLI runs can never drift.

Shapes
──────
prompt_config: {"system_prompt": str, "user_template": str}
run_config:    {"temperature": float, "max_tokens": int}
case:          {
                  "id": Any,                # opaque, echoed back on the result
                  "name": str | None,
                  "input_data": dict,       # formatted into user_template
                  "expected_output": str,
                  "check_strict": bool,
                  "check_normalised": bool,
                  "check_llm": bool,
                  "model_override": str | None,
               }

A case result dict carries the original case id plus the scoring fields from
score_result(), the model output, latency, and the raw provider response.
"""
import json
import asyncio

from app.services.llm_providers import run_inference
from app.services.scoring import score_result

DEFAULT_CONCURRENCY = 5
DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant."
DEFAULT_USER_TEMPLATE = "{input}"


def _render_user_message(user_template: str, input_data: dict) -> str:
    """
    Fill the user template with the case inputs. Falls back to a JSON dump of
    the inputs if the template references a key the case doesn't provide, so a
    misconfigured template degrades gracefully instead of crashing the run.
    """
    try:
        return user_template.format(**input_data)
    except Exception:
        return json.dumps(input_data)


async def evaluate_case(
    case: dict,
    *,
    prompt_config: dict,
    provider: str,
    model_id: str,
    run_config: dict,
    judge_provider: str = "huggingface",
    judge_model: str = "meta-llama/Meta-Llama-3-70B-Instruct",
    semaphore: asyncio.Semaphore | None = None,
) -> dict:
    """
    Run inference for a single case and score it. Never raises — any error is
    captured into a failed result dict so one bad case can't abort the run.
    """
    async def _run() -> dict:
        try:
            user_message = _render_user_message(
                prompt_config.get("user_template", DEFAULT_USER_TEMPLATE),
                case.get("input_data") or {},
            )

            inference = await run_inference(
                provider=provider,
                model_id=case.get("model_override") or model_id,
                system_prompt=prompt_config.get("system_prompt", DEFAULT_SYSTEM_PROMPT),
                user_message=user_message,
                temperature=run_config.get("temperature", 0.7),
                max_tokens=run_config.get("max_tokens", 512),
            )

            scores = await score_result(
                actual=inference.output,
                expected=case["expected_output"],
                check_strict_flag=case.get("check_strict", False),
                check_normalised_flag=case.get("check_normalised", True),
                check_llm_flag=case.get("check_llm", False),
                judge_provider=judge_provider,
                judge_model=judge_model,
            )

            return {
                "test_case_id": case.get("id"),
                "name": case.get("name"),
                "actual_output": inference.output,
                "latency_ms": inference.latency_ms,
                "raw_response": inference.raw,
                "error": None,
                **scores,
            }

        except Exception as exc:
            return {
                "test_case_id": case.get("id"),
                "name": case.get("name"),
                "actual_output": str(exc),
                "latency_ms": 0.0,
                "raw_response": {"error": str(exc)},
                "error": str(exc),
                "strict_passed": None,
                "normalised_passed": None,
                "llm_passed": None,
                "passed": False,
                "reason": str(exc),
            }

    if semaphore is None:
        return await _run()
    async with semaphore:
        return await _run()


async def evaluate_suite(
    cases: list[dict],
    *,
    prompt_config: dict,
    provider: str,
    model_id: str,
    run_config: dict | None = None,
    judge_provider: str = "huggingface",
    judge_model: str = "meta-llama/Meta-Llama-3-70B-Instruct",
    concurrency: int = DEFAULT_CONCURRENCY,
    runs: int = 1,
) -> list[dict]:
    """
    Fan out every case concurrently, capped at `concurrency` simultaneous LLM
    calls. Each case is evaluated `runs` times (default 1) — running a case
    repeatedly is what makes the per-case consistency and confidence-interval
    statistics meaningful.

    Returns a flat list of result dicts. Each result carries `test_case_id`
    (stable across repeats) and `run_index` (0-based) so callers can group the
    repeats back together. Results are ordered case-by-case, repeat-by-repeat.
    """
    if runs < 1:
        raise ValueError("runs must be >= 1")

    semaphore = asyncio.Semaphore(concurrency)
    run_config = run_config or {}

    async def _one(case: dict, run_index: int) -> dict:
        result = await evaluate_case(
            case,
            prompt_config=prompt_config,
            provider=provider,
            model_id=model_id,
            run_config=run_config,
            judge_provider=judge_provider,
            judge_model=judge_model,
            semaphore=semaphore,
        )
        result["run_index"] = run_index
        return result

    return await asyncio.gather(
        *(
            _one(case, run_index)
            for case in cases
            for run_index in range(runs)
        )
    )
