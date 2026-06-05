"""
Model registry — live model lists from HuggingFace Router and OpenRouter.

Shared by the inference router (GET /inference/models) and the CLI
(`evallayer models`) so both surface the same catalogue. Each provider fetch
degrades gracefully: a missing key or a failed request returns an empty list
and an explanatory note rather than raising.
"""
import os
import httpx

# Sensible starting points surfaced to users who don't yet know what to pick.
RECOMMENDED = {
    "default_inference": "HuggingFaceH4/zephyr-7b-beta",
    "default_judge": "meta-llama/Meta-Llama-3-70B-Instruct",
    "best_free_judge": "meta-llama/llama-3.3-70b-instruct:free",
    "best_paid_judge": "anthropic/claude-3.5-sonnet",
}


async def fetch_huggingface_models() -> tuple[list[dict], str | None]:
    token = os.getenv("HUGGINGFACE_TOKEN", "")
    if not token:
        return [], "HUGGINGFACE_TOKEN not set."
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://router.huggingface.co/v1/models",
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("data", data) if isinstance(data, dict) else data
            models = [
                {"id": m["id"] if isinstance(m, dict) else m}
                for m in raw
            ]
        return models, None
    except Exception as e:
        return [], f"Live fetch failed: {e}. Check HUGGINGFACE_TOKEN."


async def fetch_openrouter_models() -> tuple[list[dict], str | None]:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        return [], "OPENROUTER_API_KEY not set."
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {key}"},
            )
            resp.raise_for_status()
            all_models = resp.json().get("data", [])
            models = [
                {
                    "id": m["id"],
                    "name": m.get("name", m["id"]),
                    "free": ":free" in m["id"],
                    "context_length": m.get("context_length"),
                }
                for m in all_models
            ]
        # Free models first, then alphabetical within each tier.
        models.sort(key=lambda x: (not x["free"], x["id"]))
        return models, None
    except Exception as e:
        return [], f"Live fetch failed: {e}. Check OPENROUTER_API_KEY."


async def list_models() -> dict:
    """Combined catalogue for both providers, including graceful per-provider notes."""
    hf_models, hf_note = await fetch_huggingface_models()
    or_models, or_note = await fetch_openrouter_models()
    return {
        "huggingface": {"models": hf_models, "count": len(hf_models), "note": hf_note},
        "openrouter": {"models": or_models, "count": len(or_models), "note": or_note},
        "recommended": RECOMMENDED,
    }
