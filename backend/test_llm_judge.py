"""
LLM-as-judge comparison test.

Compares two models on the same suite using an LLM judge for scoring.
Runs are fired sequentially (not simultaneously) to stay within HuggingFace
free tier rate limits — the concurrency test (test_backend.py) already
validates parallel execution.

Run with (server must be running):
    python -m uvicorn app.main:app --port 8000 --workers 2
    python -m pytest test_llm_judge.py -s
"""
import asyncio
import time
import httpx
import pytest

BASE = "http://localhost:8000"

# ── Models under test ──────────────────────────────────────────────────────────
# Both confirmed working on featherless-ai via HuggingFace Router free tier.
# Using two checkpoints of the same model family for a fair apples-to-apples
# comparison — differences in pass rate reflect training, not architecture.
MODEL_A = "HuggingFaceH4/zephyr-7b-beta"
MODEL_B = "HuggingFaceH4/zephyr-7b-beta"   # same model, shows judge consistency
                                             # swap for a different model once
                                             # you have a paid HF token

PROVIDER = "huggingface"

# ── Test cases ─────────────────────────────────────────────────────────────────
# Short factual questions with unambiguous one-word answers.
# The LLM judge handles paraphrasing ("It is Paris" → pass).
CASES = [
    {
        "input": "What is the capital city of France? Answer in one word only.",
        "expected": "Paris",
    },
    {
        "input": "What is the chemical formula for water? Answer with the formula only.",
        "expected": "H2O",
    },
    {
        "input": "How many continents are there on Earth? Answer with a number only.",
        "expected": "7",
    },
    {
        "input": "What programming language is most associated with data science? One word only.",
        "expected": "Python",
    },
    {
        "input": "What is the powerhouse of the cell? Answer in one or two words only.",
        "expected": "Mitochondria",
    },
]


# ── Helpers ────────────────────────────────────────────────────────────────────

async def poll_until_complete(
    client: httpx.AsyncClient,
    run_id: int,
    label: str,
    timeout_s: int = 300,
) -> dict:
    """Poll GET /runs/{run_id} until status is complete or error."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        await asyncio.sleep(3)
        r = await client.get(f"/runs/{run_id}")
        data = r.json()
        status = data["run"]["status"]
        print(f"  [{label}] {status} | {data['run']['passed']}/{data['run']['total_cases']} passed")
        if status in ("complete", "error"):
            return data
    raise TimeoutError(f"Run {run_id} ({label}) did not complete within {timeout_s}s")


async def create_suite_with_cases(client: httpx.AsyncClient) -> int:
    suite_resp = await client.post("/suites/", json={
        "name": "LLM Judge Comparison",
        "prompt_config": {
            "system_prompt": (
                "You are a concise assistant. "
                "Answer with the shortest correct response. "
                "No explanation, no punctuation beyond what is asked."
            ),
            "user_template": "{input}",
        },
    })
    assert suite_resp.status_code == 200, f"Suite creation failed: {suite_resp.text}"
    suite_id = suite_resp.json()["id"]
    print(f"\nCreated suite {suite_id}")

    for case in CASES:
        resp = await client.post(f"/suites/{suite_id}/cases", json={
            "suite_id": suite_id,
            "input_data": {"input": case["input"]},
            "expected_output": case["expected"],
            "check_strict": False,
            "check_normalised": False,
            "check_llm": True,          # LLM judge only
        })
        assert resp.status_code == 200, f"Case creation failed: {resp.text}"

    print(f"Added {len(CASES)} cases (check_llm=True)")
    return suite_id


async def create_and_wait(
    client: httpx.AsyncClient,
    suite_id: int,
    model_id: str,
    label: str,
) -> dict:
    """Fire a run and wait for it to complete before returning."""
    resp = await client.post("/runs", json={
        "suite_id": suite_id,
        "model_id": model_id,
        "provider": PROVIDER,
        "label": label,
        "run_config": {"temperature": 0.1, "max_tokens": 32},
    })
    assert resp.status_code == 200, f"Run creation failed: {resp.text}"
    run_id = resp.json()["id"]
    print(f"\nFired run {run_id} ({label}) — waiting for completion...")
    return await poll_until_complete(client, run_id, label)


def print_run_results(label: str, model_id: str, data: dict):
    print(f"\n{'─'*60}")
    print(f"{label}: {model_id}")
    print(f"{'─'*60}")
    for r in data["results"]:
        icon = "✓" if r["passed"] else "✗"
        print(f"  {icon} actual={repr(r['actual_output'][:70])}")
        if r.get("reason"):
            print(f"    → {r['reason'][:140]}")


# ── Main test ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio(loop_scope="function")
async def test_llm_judge_comparison():
    async with httpx.AsyncClient(base_url=BASE, timeout=300) as client:

        # 1. Create shared suite
        suite_id = await create_suite_with_cases(client)

        # 2. Run Model A, wait for completion, then run Model B.
        #    Sequential execution avoids doubling the HuggingFace request rate.
        #    With check_llm=True, each case makes 2 API calls (inference + judge),
        #    so 5 cases = 10 calls per run — well within limits when not overlapping.
        t0 = time.monotonic()

        data_a = await create_and_wait(client, suite_id, MODEL_A, "Model-A")
        run_a_id = data_a["run"]["id"]

        # Brief pause between runs to let rate limit window reset
        print("\nPausing 10s between runs to respect rate limits...")
        await asyncio.sleep(10)

        data_b = await create_and_wait(client, suite_id, MODEL_B, "Model-B")
        run_b_id = data_b["run"]["id"]

        elapsed = time.monotonic() - t0

        # 3. Print results
        print_run_results("MODEL A", MODEL_A, data_a)
        print_run_results("MODEL B", MODEL_B, data_b)

        # 4. Summary
        print(f"\n{'─'*60}")
        print(f"SUMMARY")
        print(f"{'─'*60}")
        for label, model, data in [
            ("Model A", MODEL_A, data_a),
            ("Model B", MODEL_B, data_b),
        ]:
            run = data["run"]
            rel = data["statistics"]["reliability"]
            print(f"  {label} ({model})")
            print(f"    Pass rate:   {run['pass_rate']:.0%} ({run['passed']}/{run['total_cases']}) "
                  f"[{rel['ci_lower']:.0%}–{rel['ci_upper']:.0%}] — {rel['interpretation']}")
            print(f"    Avg latency: {run['avg_latency_ms']:.0f}ms")
        print(f"  Total wall time: {elapsed:.1f}s")

        # 5. Diff
        print(f"\n{'─'*60}")
        print(f"DIFF (run {run_a_id} vs {run_b_id})")
        print(f"{'─'*60}")
        compare_resp = await client.get(f"/runs/compare/{run_a_id}/{run_b_id}")
        assert compare_resp.status_code == 200, f"Compare failed: {compare_resp.text}"
        compare = compare_resp.json()

        icons = {"fixed": "✓", "regressed": "✗", "unchanged": "·", "added": "+", "removed": "-"}
        for d in compare["diff"]:
            print(f"  {icons.get(d['change'], '?')} case {d['test_case_id']:>3} "
                  f"| {d['change']:<10} | A={d['run_a']} B={d['run_b']}")

        summary = compare["summary"]
        print(f"\n  Fixes:       {summary['fixes']}")
        print(f"  Regressions: {summary['regressions']}")

        # 6. Assertions
        assert data_a["run"]["status"] == "complete", "Run A did not complete"
        assert data_b["run"]["status"] == "complete", "Run B did not complete"
        assert data_a["run"]["total_cases"] == len(CASES), "Run A case count wrong"
        assert data_b["run"]["total_cases"] == len(CASES), "Run B case count wrong"

        # Judge must have fired on at least one non-errored case per model
        def judge_fired(results: list) -> bool:
            ok = [r for r in results if not r["actual_output"].startswith("Client error")]
            return bool(ok) and any(r["llm_passed"] is not None for r in ok)

        assert judge_fired(data_a["results"]), "LLM judge did not fire for Model A"
        assert judge_fired(data_b["results"]), "LLM judge did not fire for Model B"

        # Report rate limit hits as warnings, not failures
        for label, data in [("Model A", data_a), ("Model B", data_b)]:
            hits = sum(1 for r in data["results"] if "429" in r["actual_output"])
            if hits:
                print(f"\n⚠  {label}: {hits} case(s) still rate-limited after retries.")
                print("   Upgrade to a paid HuggingFace token to eliminate this.")

        print(f"\n✓ LLM judge fired correctly on both models")
        print(f"✓ Compare endpoint working")
        print(f"✓ Test complete")