"""
Scoring service — deterministic and LLM-graded checks.

This mirrors the scoring logic currently in the EvalLayer frontend,
moved server-side so evaluation runs are reproducible and auditable.

Three check types:
  strict      — exact string match
  normalised  — whitespace / case / punctuation insensitive
  llm         — secondary LLM judges semantic correctness
"""
import re
import unicodedata
from app.services.llm_providers import run_inference


# ── Deterministic checks ───────────────────────────────────────────────────────

def check_strict(actual: str, expected: str) -> tuple[bool, str]:
    passed = actual.strip() == expected.strip()
    reason = None if passed else f"Exact match failed.\nExpected: {expected!r}\nActual:   {actual!r}"
    return passed, reason


def _normalise(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace, remove punctuation."""
    text = text.lower().strip()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def check_normalised(actual: str, expected: str) -> tuple[bool, str]:
    passed = _normalise(actual) == _normalise(expected)
    reason = (
        None if passed
        else f"Normalised match failed.\nExpected (normalised): {_normalise(expected)!r}\nActual (normalised):   {_normalise(actual)!r}"
    )
    return passed, reason


# ── LLM-graded check ──────────────────────────────────────────────────────────

JUDGE_SYSTEM_PROMPT = """You are an impartial evaluator assessing whether a language model's output
correctly answers a question or satisfies an expected result.

Respond with ONLY valid JSON in this exact format:
{"passed": true, "reason": "brief explanation"}
or
{"passed": false, "reason": "brief explanation"}

Do not include any text outside the JSON object."""

JUDGE_USER_TEMPLATE = """Expected output:
{expected}

Actual output:
{actual}

Does the actual output correctly satisfy the expected output? Consider semantic equivalence,
not just exact wording."""


async def check_llm_graded(
    actual: str,
    expected: str,
    judge_provider: str = "huggingface",
    judge_model: str = "meta-llama/Meta-Llama-3-70B-Instruct",
) -> tuple[bool, str]:
    """
    Uses a secondary LLM to judge semantic correctness.
    Defaults to a small, cheap model — override for higher-stakes evals.
    """
    import json

    user_message = JUDGE_USER_TEMPLATE.format(expected=expected, actual=actual)
    result = await run_inference(
        provider=judge_provider,
        model_id=judge_model,
        system_prompt=JUDGE_SYSTEM_PROMPT,
        user_message=user_message,
        temperature=0.0,
        max_tokens=200,
    )
    try:
        parsed = json.loads(result.output.strip())
        passed = bool(parsed.get("passed", False))
        reason = parsed.get("reason", "No reason provided")
    except (json.JSONDecodeError, KeyError):
        passed = False
        reason = f"Judge returned unparseable response: {result.output!r}"
    return passed, reason


# ── Composite scorer ───────────────────────────────────────────────────────────

async def score_result(
    actual: str,
    expected: str,
    check_strict_flag: bool,
    check_normalised_flag: bool,
    check_llm_flag: bool,
    judge_provider: str = "huggingface",
    judge_model: str = "meta-llama/Meta-Llama-3-70B-Instruct",
) -> dict:
    """
    Runs all enabled checks and returns a unified scoring dict.
    overall passed = True only if every enabled check passed.
    """
    scores = {
        "strict_passed": None,
        "normalised_passed": None,
        "llm_passed": None,
        "passed": False,
        "reason": None,
    }
    reasons = []
    enabled_results = []

    if check_strict_flag:
        p, r = check_strict(actual, expected)
        scores["strict_passed"] = p
        enabled_results.append(p)
        if not p and r:
            reasons.append(f"[strict] {r}")

    if check_normalised_flag:
        p, r = check_normalised(actual, expected)
        scores["normalised_passed"] = p
        enabled_results.append(p)
        if not p and r:
            reasons.append(f"[normalised] {r}")

    if check_llm_flag:
        p, r = await check_llm_graded(actual, expected, judge_provider, judge_model)
        scores["llm_passed"] = p
        enabled_results.append(p)
        reasons.append(f"[llm] {r}")

    scores["passed"] = all(enabled_results) if enabled_results else False
    scores["reason"] = "\n".join(reasons) if reasons else None
    return scores
