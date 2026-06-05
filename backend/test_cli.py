"""
Unit tests for the EvalLayer CLI: suite parsing, per-case aggregation, the
repeated-runs path through the shared evaluator, and the compare/McNemar logic.

These are pure unit tests — no server and no network. The one test that
exercises evaluate_suite stubs run_inference, so the whole file runs offline:

    cd backend
    python -m pytest test_cli.py -q
"""
import asyncio

import pytest

from app import cli
from app.cli import (
    load_suite,
    aggregate_cases,
    build_report,
    preflight,
    preflight_suite,
    _classify_change,
    SuiteError,
)
from app.services.stats import mcnemar_test
from app.services.llm_providers import InferenceResult


def _summary(passed, error=False):
    return {"majority_passed": passed, "any_error": error}


# ── Helpers ──────────────────────────────────────────────────────────────────

def write_suite(tmp_path, body: str):
    p = tmp_path / "suite.yaml"
    p.write_text(body, encoding="utf-8")
    return str(p)


MINIMAL = """\
model: model-a
cases:
  - name: c1
    input: { q: hi }
    expected: Paris
"""


def make_result(case_id, name, passed, output="out", reason=None, error=None):
    return {
        "test_case_id": case_id,
        "name": name,
        "passed": passed,
        "actual_output": output,
        "latency_ms": 10.0,
        "reason": reason,
        "error": error,
        "strict_passed": None,
        "normalised_passed": passed,
        "llm_passed": None,
    }


# ── Suite parsing ────────────────────────────────────────────────────────────

def test_load_suite_applies_defaults(tmp_path):
    suite = load_suite(write_suite(tmp_path, MINIMAL))
    assert suite["provider"] == "huggingface"
    assert suite["runs"] == 1
    assert suite["prompt_config"]["user_template"] == cli.DEFAULT_USER_TEMPLATE
    assert suite["judge_model"] == cli.DEFAULT_JUDGE_MODEL
    # Default check is normalised only.
    case = suite["cases"][0]
    assert case["check_normalised"] is True
    assert case["check_strict"] is False
    assert case["check_llm"] is False
    assert case["id"] == 0


def test_load_suite_checks_mapping(tmp_path):
    body = MINIMAL + "    checks: [strict, llm]\n"
    case = load_suite(write_suite(tmp_path, body))["cases"][0]
    assert case["check_strict"] is True
    assert case["check_llm"] is True
    assert case["check_normalised"] is False


def test_load_suite_unknown_check_rejected(tmp_path):
    body = MINIMAL + "    checks: [bogus]\n"
    with pytest.raises(SuiteError, match="unknown check"):
        load_suite(write_suite(tmp_path, body))


@pytest.mark.parametrize("runs", [0, -1, 2.5, "lots"])
def test_load_suite_rejects_bad_runs(tmp_path, runs):
    body = f"model: m\nruns: {runs}\ncases:\n  - {{expected: x}}\n"
    with pytest.raises(SuiteError, match="runs"):
        load_suite(write_suite(tmp_path, body))


def test_load_suite_missing_model(tmp_path):
    with pytest.raises(SuiteError, match="model"):
        load_suite(write_suite(tmp_path, "cases: [{expected: x}]\n"))


def test_load_suite_missing_expected(tmp_path):
    with pytest.raises(SuiteError, match="expected"):
        load_suite(write_suite(tmp_path, "model: m\ncases:\n  - name: c\n"))


def test_load_suite_not_found():
    with pytest.raises(SuiteError, match="not found"):
        load_suite("does/not/exist.yaml")


# ── Aggregation ──────────────────────────────────────────────────────────────

def _suite_with_cases(*names):
    return {"cases": [{"id": i, "name": n} for i, n in enumerate(names)]}


def test_aggregate_counts_and_rate():
    suite = _suite_with_cases("a")
    results = [
        make_result(0, "a", True),
        make_result(0, "a", False, reason="nope"),
        make_result(0, "a", True),
    ]
    (s,) = aggregate_cases(suite, results)
    assert (s["passes"], s["total"]) == (2, 3)
    assert s["pass_rate"] == pytest.approx(2 / 3)
    assert s["majority_passed"] is True          # 2 of 3
    assert s["reasons"] == ["nope"]


def test_aggregate_majority_tie_fails():
    """An even split is not a strict majority, so the case fails."""
    suite = _suite_with_cases("a")
    results = [make_result(0, "a", True), make_result(0, "a", False)]
    (s,) = aggregate_cases(suite, results)
    assert s["passes"] == 1 and s["total"] == 2
    assert s["majority_passed"] is False


def test_aggregate_consistency_signal():
    suite = _suite_with_cases("stable", "flaky")
    results = (
        [make_result(0, "stable", True) for _ in range(4)]      # 4/4
        + [make_result(1, "flaky", i % 2 == 0) for i in range(4)]  # 2/4
    )
    stable, flaky = aggregate_cases(suite, results)
    assert stable["consistency"]["score"] == "HIGH"
    assert flaky["consistency"]["score"] == "LOW"


def test_aggregate_preserves_suite_order_and_flags_errors():
    suite = _suite_with_cases("first", "second")
    results = [
        make_result(1, "second", False, error="boom"),
        make_result(0, "first", True),
    ]
    out = aggregate_cases(suite, results)
    assert [s["name"] for s in out] == ["first", "second"]
    assert out[1]["any_error"] is True


# ── Compare / McNemar ────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "a,b,expected",
    [
        (False, True, "fixed"),
        (True, False, "regressed"),
        (True, True, "unchanged"),
        (False, False, "unchanged"),
    ],
)
def test_classify_change(a, b, expected):
    assert _classify_change(_summary(a), _summary(b)) == expected


def test_classify_change_error_takes_precedence():
    # An errored side is 'error', never a regression/fix, regardless of verdicts.
    assert _classify_change(_summary(True), _summary(False, error=True)) == "error"
    assert _classify_change(_summary(False, error=True), _summary(True)) == "error"


def test_mcnemar_insufficient_pairs_is_inconclusive():
    a = [True, True, False]
    b = [True, True, True]      # one discordant pair
    res = mcnemar_test(a, b)
    assert res["discordant_pairs"] == 1
    assert res["significant"] is None


def test_mcnemar_detects_one_sided_difference():
    # 12 cases where A fails and B passes — a strong, consistent improvement.
    a = [False] * 12
    b = [True] * 12
    res = mcnemar_test(a, b)
    assert res["discordant_pairs"] == 12
    assert res["significant"] is True


# ── Preflight ────────────────────────────────────────────────────────────────

def test_preflight_unknown_provider():
    assert "Unknown" in preflight("openai")


def test_preflight_missing_key(monkeypatch):
    monkeypatch.delenv("HUGGINGFACE_TOKEN", raising=False)
    msg = preflight("huggingface")
    assert msg and "HUGGINGFACE_TOKEN" in msg


def test_preflight_passes_with_key(monkeypatch):
    monkeypatch.setenv("HUGGINGFACE_TOKEN", "x")
    assert preflight("huggingface") is None


def test_preflight_ollama_needs_no_key(monkeypatch):
    monkeypatch.delenv("HUGGINGFACE_TOKEN", raising=False)
    assert preflight("ollama") is None


def test_preflight_suite_checks_judge_only_when_llm_used(monkeypatch, tmp_path):
    monkeypatch.setenv("HUGGINGFACE_TOKEN", "x")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    body = """\
model: m
provider: huggingface
judge: { provider: openrouter, model: j }
cases:
  - name: c
    expected: x
    checks: [llm]
"""
    suite = load_suite(write_suite(tmp_path, body))
    # llm check → judge provider (openrouter) key required and missing.
    msg = preflight_suite(suite)
    assert msg and "OPENROUTER_API_KEY" in msg

    # Without an llm check the judge isn't consulted, so it passes.
    suite["cases"][0]["check_llm"] = False
    assert preflight_suite(suite) is None


# ── Repeated runs through the evaluator ──────────────────────────────────────

def test_evaluate_suite_runs_each_case_n_times(tmp_path, monkeypatch):
    calls = {"n": 0}

    async def fake_inference(*, provider, model_id, system_prompt,
                             user_message, temperature, max_tokens):
        calls["n"] += 1
        # france → Paris (pass), japan → Wrong (fail) under normalised check.
        out = "Paris" if "france" in user_message else "Wrong"
        return InferenceResult(output=out, latency_ms=5.0, raw={})

    monkeypatch.setattr("app.services.evaluator.run_inference", fake_inference)

    body = """\
model: m
runs: 3
prompt: { user_template: "{q}" }
cases:
  - name: france
    input: { q: "capital of france" }
    expected: Paris
    checks: [normalised]
  - name: japan
    input: { q: "capital of japan" }
    expected: Tokyo
    checks: [normalised]
"""
    suite = load_suite(write_suite(tmp_path, body))
    results = asyncio.run(cli._run_suite(suite, concurrency=4))

    # 2 cases × 3 runs = 6 inference calls / results, each tagged with run_index.
    assert calls["n"] == 6
    assert len(results) == 6
    assert sorted(r["run_index"] for r in results) == [0, 0, 1, 1, 2, 2]

    france, japan = aggregate_cases(suite, results)
    assert (france["passes"], france["total"]) == (3, 3)
    assert france["majority_passed"] is True
    assert (japan["passes"], japan["total"]) == (0, 3)
    assert japan["majority_passed"] is False


def test_build_report_includes_runs_and_per_case_stats():
    suite = {
        "name": "S", "model": "m", "provider": "huggingface",
        "judge_model": "j", "judge_provider": "huggingface",
        "run_config": {}, "runs": 2,
        "cases": [{"id": 0, "name": "a"}],
    }
    results = [make_result(0, "a", True), make_result(0, "a", False)]
    summaries = aggregate_cases(suite, results)
    report = build_report(suite, results, summaries, {
        "reliability": {"x": 1}, "consistency": {"y": 2},
    })
    assert report["metadata"]["runsPerCase"] == 2
    assert report["metadata"]["datasetSize"] == 1
    assert report["summary"]["totalRuns"] == 2
    assert report["statisticalAnalysis"]["perTestCase"][0]["name"] == "a"
