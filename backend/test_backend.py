"""
Backend integration tests.

Run with:
    python -m pytest test_backend.py -s

Requires the FastAPI server to be running:
    python -m uvicorn app.main:app --reload --port 8000
"""
import asyncio
import time
import httpx
import pytest

BASE = "http://localhost:8000"


# ── pytest-asyncio configuration ───────────────────────────────────────────────
# Silences the loop-scope deprecation warning and makes AUTO mode work so
# we don't need @pytest.mark.asyncio on every single test.

def pytest_configure(config):
    config.addinivalue_line(
        "markers", "asyncio: mark test as async"
    )


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio(loop_scope="function")
async def test_concurrent_run():
    """
    Verifies that test cases inside a run execute concurrently.

    With CONCURRENCY_LIMIT=5 and 5 cases, wall time should be roughly
    equal to one case's latency — not 5x it.
    """
    async with httpx.AsyncClient(base_url=BASE, timeout=120) as client:

        # 1. Create a suite
        suite_resp = await client.post("/suites/", json={
            "name": "Concurrency test",
            "prompt_config": {
                "system_prompt": "You are a helpful assistant.",
                "user_template": "{input}",
            },
        })
        assert suite_resp.status_code == 200, f"Suite creation failed: {suite_resp.text}"
        suite_id = suite_resp.json()["id"]

        # 2. Add 5 test cases
        for i in range(5):
            case_resp = await client.post(f"/suites/{suite_id}/cases", json={
                "suite_id": suite_id,
                "input_data": {"input": f"Reply with only the digit {i} and nothing else."},
                "expected_output": str(i),
                "check_normalised": True,
            })
            assert case_resp.status_code == 200, f"Case creation failed: {case_resp.text}"

        # 3. Fire the run
        t0 = time.monotonic()
        run_resp = await client.post("/runs", json={
            "suite_id": suite_id,
            "model_id": "HuggingFaceH4/zephyr-7b-beta",
            "provider": "huggingface",
            "run_config": {"temperature": 0.0, "max_tokens": 16},
        })
        assert run_resp.status_code == 200, f"Run creation failed: {run_resp.text}"
        run_id = run_resp.json()["id"]

        # 4. Poll until complete (max 2 minutes)
        r = None
        for _ in range(60):
            await asyncio.sleep(2)
            r = await client.get(f"/runs/{run_id}")
            status = r.json()["run"]["status"]
            if status in ("complete", "error"):
                break

        assert r is not None
        elapsed = time.monotonic() - t0
        data = r.json()

        print(f"\nTotal wall time:      {elapsed:.1f}s")
        print(f"Avg latency per case: {data['run']['avg_latency_ms']:.0f}ms")
        print(f"Pass rate:            {data['run']['pass_rate']:.0%}")
        print(f"Status:               {data['run']['status']}")

        # Print individual results so we can see what the model actually said
        for result in data["results"]:
            print(
                f"  case {result['test_case_id']}: "
                f"passed={result['passed']} | "
                f"actual={repr(result['actual_output'][:80])}"
            )

        # Run must complete (not error)
        assert data["run"]["status"] == "complete", "Run did not complete successfully"
        assert data["run"]["total_cases"] == 5, "Not all cases were processed"

        # Concurrency check — only meaningful if cases actually ran
        avg_ms = data["run"]["avg_latency_ms"]
        if avg_ms > 0:
            avg_s = avg_ms / 1000
            assert elapsed < avg_s * 2.5, (
                f"Looks sequential! Wall time {elapsed:.1f}s >> avg latency {avg_s:.1f}s.\n"
                f"Expected wall time ≈ {avg_s:.1f}s (one case) not {elapsed:.1f}s (5 cases)."
            )
            print("✓ Concurrency confirmed")
        else:
            # All cases errored — print reasons to help debug
            for result in data["results"]:
                if result.get("reason"):
                    print(f"  ERROR case {result['test_case_id']}: {result['reason']}")
            pytest.fail("All cases returned latency=0 — inference is failing, check reasons above")