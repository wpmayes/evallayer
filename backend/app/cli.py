"""
EvalLayer CLI — run evaluation suites from the terminal, no server required.

EvalLayer ships as a ready-to-go test harness: drop your own provider key in a
.env file, write a suite as a YAML file, and run it. Inference, scoring, and
statistics use the exact same code as the web UI (via app.services.evaluator),
so a suite run from the CLI is equivalent to one run from the frontend.

After `pip install -e .` the commands below are available as `evallayer …`;
without installing, use the equivalent `python -m app.cli …`.

Usage
─────
    evallayer models                       # discover model IDs to test
    evallayer init [path]                  # scaffold an example suite
    evallayer run suite.yaml               # run a suite, print results
    evallayer run suite.yaml --report out.json --threshold 0.8
    evallayer compare suite.yaml --model-b other/model   # A/B two models

Provider keys are read from the environment, or from a .env file in the current
directory (HUGGINGFACE_TOKEN / OPENROUTER_API_KEY). `run` and `compare` check
the key up front and fail fast if it's missing.

Set `runs: N` in the suite to evaluate every case N times — this is what makes
the per-case consistency score and confidence intervals meaningful.

Exit codes
──────────
    0   pass rate >= --threshold (run) / no regressions (compare)
    1   pass rate < --threshold, or a regression with --fail-on-regression
    2   bad usage / suite file error

A suite file (YAML; JSON also works since YAML is a JSON superset):

    name: Geography basics
    provider: huggingface          # huggingface | openrouter | ollama
    model: HuggingFaceH4/zephyr-7b-beta
    prompt:
      system_prompt: "Answer with just the answer, no preamble."
      user_template: "{question}"
    run_config:
      temperature: 0.0
      max_tokens: 256
    judge:                         # only used by cases with an 'llm' check
      provider: huggingface
      model: meta-llama/Meta-Llama-3-70B-Instruct
    cases:
      - name: capital-france
        input: { question: "What is the capital of France?" }
        expected: Paris
        checks: [normalised]       # any of: strict, normalised, llm
"""
import os
import sys
import json
import asyncio
import argparse
from datetime import datetime, timezone

import yaml
from dotenv import load_dotenv, find_dotenv

from app.services.evaluator import (
    evaluate_suite,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_USER_TEMPLATE,
    DEFAULT_CONCURRENCY,
)
from app.services.stats import (
    run_statistics,
    wilson_ci,
    consistency_score,
    mcnemar_test,
)
from app.services import model_registry

VALID_CHECKS = {"strict", "normalised", "llm"}
DEFAULT_JUDGE_PROVIDER = "huggingface"
DEFAULT_JUDGE_MODEL = "meta-llama/Meta-Llama-3-70B-Instruct"

# Which environment variable holds each provider's key. ollama needs none.
PROVIDER_KEY_ENV = {
    "huggingface": "HUGGINGFACE_TOKEN",
    "openrouter": "OPENROUTER_API_KEY",
    "ollama": None,
}

EXAMPLE_SUITE = """\
# EvalLayer suite — edit this and run:  python -m app.cli run suite.yaml
name: Geography basics
provider: huggingface            # huggingface | openrouter | ollama
model: HuggingFaceH4/zephyr-7b-beta

prompt:
  system_prompt: "Answer with just the answer, no preamble or explanation."
  user_template: "{question}"

run_config:
  temperature: 0.0
  max_tokens: 256

# Run every case this many times. >1 enables per-case consistency scoring
# and tighter confidence intervals (LLM outputs vary run-to-run).
runs: 1

# Only consulted by cases that enable the 'llm' check.
judge:
  provider: huggingface
  model: meta-llama/Meta-Llama-3-70B-Instruct

cases:
  - name: capital-france
    input: { question: "What is the capital of France?" }
    expected: Paris
    checks: [normalised]

  - name: capital-japan
    input: { question: "What is the capital of Japan?" }
    expected: Tokyo
    checks: [normalised]

  - name: largest-planet
    input: { question: "Which is the largest planet in our solar system?" }
    expected: Jupiter
    checks: [normalised, llm]
"""


# ── Suite parsing ────────────────────────────────────────────────────────────

class SuiteError(Exception):
    """Raised when a suite file is missing required fields or malformed."""


def _checks_to_flags(checks: list[str], case_label: str) -> dict:
    """Map a case's `checks: [...]` list onto the three boolean flags."""
    unknown = set(checks) - VALID_CHECKS
    if unknown:
        raise SuiteError(
            f"Case {case_label!r} has unknown check(s) {sorted(unknown)}; "
            f"valid checks are {sorted(VALID_CHECKS)}."
        )
    return {
        "check_strict": "strict" in checks,
        "check_normalised": "normalised" in checks,
        "check_llm": "llm" in checks,
    }


def load_suite(path: str) -> dict:
    """
    Read and validate a suite file into the normalised shape the evaluator and
    reporter expect. Raises SuiteError with an actionable message on problems.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
    except FileNotFoundError:
        raise SuiteError(f"Suite file not found: {path}")
    except yaml.YAMLError as exc:
        raise SuiteError(f"Could not parse {path}: {exc}")

    if not isinstance(raw, dict):
        raise SuiteError(f"{path} must be a YAML mapping at the top level.")

    for required in ("model", "cases"):
        if not raw.get(required):
            raise SuiteError(f"{path} is missing required field {required!r}.")

    prompt = raw.get("prompt") or {}
    judge = raw.get("judge") or {}

    runs = raw.get("runs", 1)
    if not isinstance(runs, int) or runs < 1:
        raise SuiteError(f"{path}: 'runs' must be a positive integer (got {runs!r}).")

    cases = []
    for i, c in enumerate(raw["cases"]):
        label = c.get("name") or f"#{i + 1}"
        if "expected" not in c:
            raise SuiteError(f"Case {label!r} is missing 'expected'.")
        checks = c.get("checks")
        if checks is None:
            checks = ["normalised"]          # sensible default
        if not isinstance(checks, list):
            raise SuiteError(f"Case {label!r}: 'checks' must be a list.")
        cases.append(
            {
                "id": i,
                "name": c.get("name") or label,
                "input_data": c.get("input") or {},
                "expected_output": str(c["expected"]),
                "model_override": c.get("model"),
                **_checks_to_flags(checks, label),
            }
        )

    return {
        "name": raw.get("name", "Untitled suite"),
        "provider": raw.get("provider", "huggingface"),
        "model": raw["model"],
        "prompt_config": {
            "system_prompt": prompt.get("system_prompt", DEFAULT_SYSTEM_PROMPT),
            "user_template": prompt.get("user_template", DEFAULT_USER_TEMPLATE),
        },
        "run_config": raw.get("run_config") or {},
        "judge_provider": judge.get("provider", DEFAULT_JUDGE_PROVIDER),
        "judge_model": judge.get("model", DEFAULT_JUDGE_MODEL),
        "runs": runs,
        "cases": cases,
    }


# ── Preflight ────────────────────────────────────────────────────────────────

def preflight(provider: str, *, role: str = "provider") -> str | None:
    """
    Validate a provider and its API key before making any network calls, so a
    missing key surfaces as one clear message instead of an identical error on
    every test case. Returns an error string, or None if everything is in place.
    """
    if provider not in PROVIDER_KEY_ENV:
        return (
            f"Unknown {role} {provider!r}. "
            f"Choose from: {sorted(PROVIDER_KEY_ENV)}."
        )
    env = PROVIDER_KEY_ENV[provider]
    if env and not os.getenv(env):
        return (
            f"{env} is not set, but {role} {provider!r} needs it. "
            f"Add it to your environment or a .env file in this directory."
        )
    return None


def preflight_suite(suite: dict) -> str | None:
    """Check the suite's inference provider, plus the judge if any case uses it."""
    err = preflight(suite["provider"])
    if err:
        return err
    if any(c["check_llm"] for c in suite["cases"]):
        return preflight(suite["judge_provider"], role="judge provider")
    return None


# ── Aggregation ──────────────────────────────────────────────────────────────

def aggregate_cases(suite: dict, results: list[dict]) -> list[dict]:
    """
    Group the flat result list (cases × runs) back into one summary per case,
    preserving the suite's case order. Each summary carries the pass count,
    Wilson CI, and consistency score — the per-case statistics that only become
    meaningful once a case has been run more than once.

    `majority_passed` is the per-case verdict used for model comparison: a case
    counts as a pass if it passed in a strict majority of its runs (ties fail).
    """
    by_id: dict = {}
    for r in results:
        by_id.setdefault(r["test_case_id"], []).append(r)

    summaries = []
    for case in suite["cases"]:
        case_runs = by_id.get(case["id"], [])
        total = len(case_runs)
        passes = sum(1 for r in case_runs if r["passed"])
        reasons = [
            r.get("reason") or r.get("error")
            for r in case_runs
            if not r["passed"] and (r.get("reason") or r.get("error"))
        ]
        summaries.append(
            {
                "test_case_id": case["id"],
                "name": case["name"],
                "passes": passes,
                "total": total,
                "pass_rate": passes / total if total else 0.0,
                "majority_passed": passes * 2 > total,
                "any_error": any(r.get("error") for r in case_runs),
                "reliability": wilson_ci(passes, total),
                "consistency": consistency_score(passes, total),
                "sample_output": case_runs[0]["actual_output"] if case_runs else "",
                "avg_latency_ms": (
                    sum(r["latency_ms"] for r in case_runs) / total if total else 0.0
                ),
                # Distinct failure reasons, order-preserved.
                "reasons": list(dict.fromkeys(reasons)),
            }
        )
    return summaries


# ── Output ───────────────────────────────────────────────────────────────────

# ANSI colour, disabled when output isn't a TTY or NO_COLOR is set.
_COLOR = sys.stdout.isatty() and not os.getenv("NO_COLOR")


def _c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def _truncate(text: str, width: int) -> str:
    text = " ".join(str(text).split())          # collapse newlines/whitespace
    return text if len(text) <= width else text[: width - 1] + "…"


def _verdict(summary: dict) -> str:
    """Coloured single-run verdict cell (used when runs == 1)."""
    if summary["any_error"]:
        return _c("ERROR ", "33")
    return _c("PASS  ", "32") if summary["majority_passed"] else _c("FAIL  ", "31")


def print_table(summaries: list[dict], runs: int) -> None:
    name_w, out_w = 22, 38
    print()
    if runs == 1:
        # Single run per case: show a plain pass/fail verdict.
        print(f"  {'CASE':<{name_w}} {'RESULT':<7} {'OUTPUT':<{out_w}}")
        print("  " + "─" * (name_w + 7 + out_w + 1))
        for s in summaries:
            name = _truncate(s["name"], name_w)
            out = _truncate(s["sample_output"], out_w)
            print(f"  {name:<{name_w}} {_verdict(s):<7} {out:<{out_w}}")
    else:
        # Repeated runs: show pass count, rate, and consistency per case.
        print(
            f"  {'CASE':<{name_w}} {'PASS':<7} {'RATE':<7} "
            f"{'CONSISTENCY':<12} {'OUTPUT':<{out_w}}"
        )
        print("  " + "─" * (name_w + 7 + 7 + 12 + out_w + 3))
        for s in summaries:
            name = _truncate(s["name"], name_w)
            count = f"{s['passes']}/{s['total']}"
            rate = f"{s['pass_rate'] * 100:.0f}%"
            con = s["consistency"]["score"]
            con_col = {"HIGH": "32", "MEDIUM": "33", "LOW": "31"}.get(con, "0")
            out = _truncate(s["sample_output"], out_w)
            print(
                f"  {name:<{name_w}} {count:<7} {rate:<7} "
                f"{_c(f'{con:<12}', con_col)} {out:<{out_w}}"
            )

    # Surface failure/error reasons beneath the table.
    notes = [s for s in summaries if not s["majority_passed"] or s["any_error"]]
    if notes:
        print()
        for s in notes:
            reason = _truncate(s["reasons"][0] if s["reasons"] else "", 90)
            print(f"  {_c('✗', '31')} {s['name']}: {reason}")


def print_summary(
    stats: dict, passed: int, total: int, avg_latency: float, runs: int
) -> None:
    rel = stats["reliability"]
    con = stats["consistency"]
    rate = f"{rel['pass_rate'] * 100:.1f}%"
    print()
    suffix = f"  [{runs} run(s) × {total // runs} case(s)]" if runs > 1 else ""
    print(f"  Pass rate    {_c(rate, '1')}  ({passed}/{total}){suffix}")
    print(
        f"  95% CI       {rel['ci_lower'] * 100:.1f}% – {rel['ci_upper'] * 100:.1f}%"
        f"   ({rel['interpretation']})"
    )
    print(f"  Consistency  {con['score']}  ({con['description']})")
    print(f"  Avg latency  {avg_latency:.0f} ms")
    print()


def build_report(
    suite: dict, results: list[dict], summaries: list[dict], stats: dict
) -> dict:
    """JSON report mirroring the frontend's export shape for interoperability."""
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    avg_latency = sum(r["latency_ms"] for r in results) / total if total else 0.0

    def _rate(flag: str) -> float | None:
        graded = [r for r in results if r.get(flag) is not None]
        if not graded:
            return None
        return sum(1 for r in graded if r[flag]) / len(graded)

    return {
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "suite": suite["name"],
            "datasetSize": len(suite["cases"]),
            "runsPerCase": suite["runs"],
            "model": suite["model"],
            "provider": suite["provider"],
            "judgeModel": suite["judge_model"],
            "judgeProvider": suite["judge_provider"],
            "temperature": suite["run_config"].get("temperature"),
            "maxTokens": suite["run_config"].get("max_tokens"),
        },
        "summary": {
            "passRate": passed / total if total else 0.0,
            "avgLatency": avg_latency,
            "passedRuns": passed,
            "totalRuns": total,
        },
        "statisticalAnalysis": {
            "overall": {
                "reliability": stats["reliability"],
                "consistency": stats["consistency"],
            },
            "perTestCase": [
                {
                    "name": s["name"],
                    "passes": s["passes"],
                    "total": s["total"],
                    "reliability": s["reliability"],
                    "consistency": s["consistency"],
                }
                for s in summaries
            ],
            "methodologyNote": (
                "Wilson score CI (95%). Consistency via Bernoulli variance."
            ),
        },
        "checkPerformance": {
            "deterministicPassRate": _rate("strict_passed"),
            "normalizedPassRate": _rate("normalised_passed"),
            "llmPassRate": _rate("llm_passed"),
        },
        "results": [
            {
                "name": r.get("name"),
                "run_index": r.get("run_index"),
                "passed": r["passed"],
                "actual_output": r["actual_output"],
                "strict_passed": r.get("strict_passed"),
                "normalised_passed": r.get("normalised_passed"),
                "llm_passed": r.get("llm_passed"),
                "reason": r.get("reason"),
                "error": r.get("error"),
                "latency_ms": r["latency_ms"],
            }
            for r in results
        ],
    }


# ── Commands ─────────────────────────────────────────────────────────────────

def cmd_init(args: argparse.Namespace) -> int:
    path = args.path
    if os.path.exists(path) and not args.force:
        print(f"Refusing to overwrite existing {path} (use --force).", file=sys.stderr)
        return 2
    with open(path, "w", encoding="utf-8") as f:
        f.write(EXAMPLE_SUITE)
    print(f"Wrote example suite to {path}")
    print(f"Edit it, then run:  python -m app.cli run {path}")
    return 0


async def _run_suite(
    suite: dict,
    concurrency: int,
    *,
    provider: str | None = None,
    model: str | None = None,
) -> list[dict]:
    """Run a suite, optionally overriding the provider/model (used by compare)."""
    return await evaluate_suite(
        suite["cases"],
        prompt_config=suite["prompt_config"],
        provider=provider or suite["provider"],
        model_id=model or suite["model"],
        run_config=suite["run_config"],
        judge_provider=suite["judge_provider"],
        judge_model=suite["judge_model"],
        concurrency=concurrency,
        runs=suite["runs"],
    )


def cmd_run(args: argparse.Namespace) -> int:
    try:
        suite = load_suite(args.suite)
    except SuiteError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    err = preflight_suite(suite)
    if err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    runs = suite["runs"]
    runs_note = f" × {runs} run(s)" if runs > 1 else ""
    print(
        f"Running suite {_c(suite['name'], '1')} "
        f"— {len(suite['cases'])} case(s){runs_note} "
        f"on {suite['provider']}/{suite['model']}"
    )

    results = asyncio.run(_run_suite(suite, args.concurrency))
    summaries = aggregate_cases(suite, results)

    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    avg_latency = sum(r["latency_ms"] for r in results) / total if total else 0.0
    stats = run_statistics(passed, total)
    report = build_report(suite, results, summaries, stats)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_table(summaries, runs)
        print_summary(stats, passed, total, avg_latency, runs)

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        if not args.json:
            print(f"  Report written to {args.report}")

    pass_rate = passed / total if total else 0.0
    if args.threshold is not None and pass_rate < args.threshold:
        if not args.json:
            print(
                _c(
                    f"  FAILED: pass rate {pass_rate * 100:.1f}% "
                    f"< threshold {args.threshold * 100:.1f}%",
                    "31",
                ),
                file=sys.stderr,
            )
        return 1
    return 0


def _classify_change(sa: dict, sb: dict) -> str:
    """
    Per-case change between model A and B. A case where either model errored is
    classified 'error' (not regressed/fixed) so a broken model isn't mistaken
    for a quality change.
    """
    if sa["any_error"] or sb["any_error"]:
        return "error"
    a, b = sa["majority_passed"], sb["majority_passed"]
    if a == b:
        return "unchanged"
    return "fixed" if (not a and b) else "regressed"


def cmd_compare(args: argparse.Namespace) -> int:
    """
    Run the suite against two models on identical cases and compare them with
    McNemar's paired test. Model A is the suite's model; model B is --model-b.
    When runs > 1, each case is reduced to a single pass/fail by majority vote
    before comparison (per the McNemar paired-design assumption).
    """
    try:
        suite = load_suite(args.suite)
    except SuiteError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    provider_a, model_a = suite["provider"], suite["model"]
    provider_b = args.provider_b or provider_a
    model_b = args.model_b

    # Preflight both sides (and the judge, if used) before any network calls.
    for prov, role in ((provider_a, "provider"), (provider_b, "provider B")):
        err = preflight(prov, role=role)
        if err:
            print(f"error: {err}", file=sys.stderr)
            return 2
    if any(c["check_llm"] for c in suite["cases"]):
        err = preflight(suite["judge_provider"], role="judge provider")
        if err:
            print(f"error: {err}", file=sys.stderr)
            return 2

    print(
        f"Comparing on suite {_c(suite['name'], '1')} "
        f"— {len(suite['cases'])} case(s) × {suite['runs']} run(s)"
    )
    print(f"  A: {provider_a}/{model_a}")
    print(f"  B: {provider_b}/{model_b}")

    results_a = asyncio.run(_run_suite(suite, args.concurrency))
    results_b = asyncio.run(
        _run_suite(suite, args.concurrency, provider=provider_b, model=model_b)
    )
    summaries_a = aggregate_cases(suite, results_a)
    summaries_b = aggregate_cases(suite, results_b)

    # Per-case majority verdicts, aligned by suite case order.
    bools_a = [s["majority_passed"] for s in summaries_a]
    bools_b = [s["majority_passed"] for s in summaries_b]
    mcnemar = mcnemar_test(bools_a, bools_b)

    diff = []
    for sa, sb in zip(summaries_a, summaries_b):
        diff.append(
            {
                "name": sa["name"],
                "a_passed": sa["majority_passed"],
                "b_passed": sb["majority_passed"],
                "a_error": sa["any_error"],
                "b_error": sb["any_error"],
                "a_rate": sa["pass_rate"],
                "b_rate": sb["pass_rate"],
                "change": _classify_change(sa, sb),
            }
        )
    regressions = sum(1 for d in diff if d["change"] == "regressed")
    fixes = sum(1 for d in diff if d["change"] == "fixed")
    errored = sum(1 for d in diff if d["change"] == "error")
    # Total errored runs per model — useful to tell "bad model ID" from "0/N".
    a_err_runs = sum(1 for r in results_a if r.get("error"))
    b_err_runs = sum(1 for r in results_b if r.get("error"))

    report = {
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "suite": suite["name"],
            "datasetSize": len(suite["cases"]),
            "runsPerCase": suite["runs"],
            "modelA": {"provider": provider_a, "model": model_a},
            "modelB": {"provider": provider_b, "model": model_b},
        },
        "mcnemar": mcnemar,
        "summary": {
            "regressions": regressions,
            "fixes": fixes,
            "errored_cases": errored,
            "errored_runs": {"a": a_err_runs, "b": b_err_runs},
        },
        "diff": diff,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        name_w = 24

        def _cell(passed: bool, errored: bool) -> str:
            return "ERR" if errored else ("PASS" if passed else "FAIL")

        print()
        print(f"  {'CASE':<{name_w}} {'A':<6} {'B':<6} CHANGE")
        print("  " + "─" * (name_w + 6 + 6 + 10))
        colours = {"regressed": "31", "fixed": "32", "unchanged": "2", "error": "33"}
        for d in diff:
            a = _cell(d["a_passed"], d["a_error"])
            b = _cell(d["b_passed"], d["b_error"])
            print(
                f"  {_truncate(d['name'], name_w):<{name_w}} "
                f"{a:<6} {b:<6} {_c(d['change'], colours[d['change']])}"
            )
        print()
        print(f"  Fixes        {_c(str(fixes), '32')}")
        print(f"  Regressions  {_c(str(regressions), '31')}")
        if errored:
            print(f"  Errored      {_c(str(errored), '33')} case(s)")
        print(f"  McNemar      {mcnemar['interpretation']}")
        if a_err_runs or b_err_runs:
            print()
            print(
                _c(
                    f"  ⚠ {a_err_runs} run(s) errored on A, {b_err_runs} on B — "
                    f"check model IDs / API keys. Comparison may be unreliable.",
                    "33",
                )
            )
        print()

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        if not args.json:
            print(f"  Report written to {args.report}")

    if args.fail_on_regression and (regressions > 0 or errored > 0):
        if not args.json:
            detail = f"{regressions} regression(s)"
            if errored:
                detail += f", {errored} errored case(s)"
            print(_c(f"  FAILED: {detail} detected", "31"), file=sys.stderr)
        return 1
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    """
    List models available from HuggingFace Router and/or OpenRouter, so users
    can discover IDs to drop into a suite or `compare --model-b`.
    """
    catalogue = asyncio.run(model_registry.list_models())

    if args.json:
        print(json.dumps(catalogue, indent=2))
        return 0

    wanted = {args.provider} if args.provider else {"huggingface", "openrouter"}
    for provider in ("huggingface", "openrouter"):
        if provider not in wanted:
            continue
        block = catalogue[provider]
        models = block["models"]
        if args.free:
            models = [m for m in models if m.get("free")]
        if args.search:
            q = args.search.lower()
            models = [m for m in models if q in m["id"].lower()]

        print()
        print(f"  {_c(provider, '1')}  ({block['count']} available)")
        if block["note"]:
            print(f"  {_c(block['note'], '33')}")
        shown = models[: args.limit]
        for m in shown:
            tag = _c(" free", "32") if m.get("free") else ""
            print(f"    {m['id']}{tag}")
        if len(models) > len(shown):
            print(f"    … and {len(models) - len(shown)} more (raise --limit or --search)")

    rec = catalogue["recommended"]
    print()
    print(f"  {_c('recommended', '1')}")
    for k, v in rec.items():
        print(f"    {k:<18} {v}")
    print()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="evallayer",
        description="Run EvalLayer evaluation suites from the command line.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Scaffold an example suite file.")
    p_init.add_argument("path", nargs="?", default="suite.yaml", help="Output path.")
    p_init.add_argument("--force", action="store_true", help="Overwrite if it exists.")
    p_init.set_defaults(func=cmd_init)

    p_run = sub.add_parser("run", help="Run a suite file.")
    p_run.add_argument("suite", help="Path to the suite YAML/JSON file.")
    p_run.add_argument("--report", metavar="PATH", help="Write a JSON report to PATH.")
    p_run.add_argument(
        "--threshold",
        type=float,
        default=None,
        metavar="0..1",
        help="Exit non-zero if the pass rate falls below this (e.g. 0.8). For CI.",
    )
    p_run.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Max simultaneous LLM calls (default {DEFAULT_CONCURRENCY}).",
    )
    p_run.add_argument(
        "--json", action="store_true", help="Emit the JSON report to stdout only."
    )
    p_run.set_defaults(func=cmd_run)

    p_cmp = sub.add_parser(
        "compare",
        help="Run two models on the same suite and compare with McNemar's test.",
    )
    p_cmp.add_argument("suite", help="Path to the suite YAML/JSON file (model = A).")
    p_cmp.add_argument(
        "--model-b", required=True, metavar="MODEL", help="Second model to compare (B)."
    )
    p_cmp.add_argument(
        "--provider-b",
        metavar="PROVIDER",
        help="Provider for model B (defaults to the suite's provider).",
    )
    p_cmp.add_argument("--report", metavar="PATH", help="Write a JSON report to PATH.")
    p_cmp.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Max simultaneous LLM calls (default {DEFAULT_CONCURRENCY}).",
    )
    p_cmp.add_argument(
        "--fail-on-regression",
        action="store_true",
        help="Exit non-zero if any case regressed from A to B. For CI.",
    )
    p_cmp.add_argument(
        "--json", action="store_true", help="Emit the JSON report to stdout only."
    )
    p_cmp.set_defaults(func=cmd_compare)

    p_models = sub.add_parser(
        "models", help="List available models from HuggingFace / OpenRouter."
    )
    p_models.add_argument(
        "--provider",
        choices=["huggingface", "openrouter"],
        help="Show only one provider (default: both).",
    )
    p_models.add_argument(
        "--search", metavar="TEXT", help="Filter by substring of the model ID."
    )
    p_models.add_argument(
        "--free", action="store_true", help="OpenRouter only — show free models."
    )
    p_models.add_argument(
        "--limit", type=int, default=40, help="Max models per provider (default 40)."
    )
    p_models.add_argument(
        "--json", action="store_true", help="Emit the raw catalogue as JSON."
    )
    p_models.set_defaults(func=cmd_models)
    return parser


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to cp1252 and can't encode the box-drawing and
    # dash characters used in the table; force UTF-8 where the stream allows it.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    # Load a .env from the current working directory (or a parent), so a user
    # running `evallayer` from their own project picks up their local keys.
    # Real environment variables always take precedence (override=False).
    load_dotenv(find_dotenv(usecwd=True), override=False)

    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
