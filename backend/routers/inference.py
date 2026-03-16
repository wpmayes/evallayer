"""
Inference router — direct proxy replacing the Netlify serverless functions.

Endpoints:
  POST /inference/complete    single-turn inference
  GET  /inference/providers   list providers with config notes
  GET  /inference/models      live model list from HF Router and OpenRouter
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
import os
from app.services.llm_providers import run_inference

router = APIRouter()


# ── Request / Response models ──────────────────────────────────────────────────

class InferenceRequest(BaseModel):
    provider: str
    model_id: str
    system_prompt: str
    user_message: str
    temperature: float = 0.7
    max_tokens: int = 512


class InferenceResponse(BaseModel):
    output: str
    latency_ms: float
    model_id: str
    provider: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/complete", response_model=InferenceResponse)
async def complete(req: InferenceRequest):
    """
    Single-turn inference endpoint.
    Drop-in replacement for /.netlify/functions/run_llm.
    Update frontend's VITE_API_BASE_URL to point here.

    Provider selection for HuggingFace:
    - Pass model_id without suffix to use :fastest policy (recommended)
    - Append :fastest, :cheapest, or :preferred for explicit policy
    - Append :provider-name (e.g. :featherless-ai) for explicit provider
    """
    try:
        result = await run_inference(
            provider=req.provider,
            model_id=req.model_id,
            system_prompt=req.system_prompt,
            user_message=req.user_message,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Model rate limited — wait a moment and retry, "
                    "or try a different model."
                ),
            )
        raise HTTPException(
            status_code=502,
            detail=f"Upstream inference error: {e}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream inference error: {e}",
        )

    usage = result.raw.get("usage", {})

    return InferenceResponse(
        output=result.output,
        latency_ms=result.latency_ms,
        model_id=req.model_id,
        provider=req.provider,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
    )


@router.get("/providers")
def list_providers():
    """Returns available providers with configuration notes."""
    return {
        "providers": [
            {
                "id": "huggingface",
                "name": "Hugging Face Router",
                "notes": (
                    "Free. Set HUGGINGFACE_TOKEN. "
                    "Automatically selects fastest available provider. "
                    "Append :fastest, :cheapest, or :provider-name to model ID "
                    "for explicit control."
                ),
            },
            {
                "id": "openrouter",
                "name": "OpenRouter",
                "notes": (
                    "Free tier available with rate limits. "
                    "Paid tier from ~$0.001/call. "
                    "Access to frontier models including GPT-4o and Claude. "
                    "Set OPENROUTER_API_KEY."
                ),
            },
            {
                "id": "ollama",
                "name": "Ollama (local)",
                "notes": (
                    "Free, runs locally. No key needed. "
                    "Best for development and offline testing."
                ),
            },
        ]
    }


@router.get("/models")
async def list_models():
    """
    Returns available models by provider, fetched live.
    HuggingFace models fetched from HF Router — always current.
    OpenRouter models fetched from OpenRouter API — free models sorted first.
    Falls back gracefully with error note if either fetch fails.
    """
    hf_models = []
    hf_note = None
    or_models = []
    or_note = None

    # ── HuggingFace — fetch live from Router ───────────────────────────────────
    token = os.getenv("HUGGINGFACE_TOKEN", "")
    if token:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://router.huggingface.co/v1/models",
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data.get("data", data) if isinstance(data, dict) else data
                hf_models = [
                    {
                        "id": m["id"] if isinstance(m, dict) else m,
                        "policy_hint": (
                            "Append :fastest, :cheapest, or "
                            ":provider-name to override selection"
                        ),
                    }
                    for m in raw
                ]
        except Exception as e:
            hf_note = f"Live fetch failed: {e}. Check HUGGINGFACE_TOKEN."
    else:
        hf_note = "HUGGINGFACE_TOKEN not set."

    # ── OpenRouter — fetch live ────────────────────────────────────────────────
    key = os.getenv("OPENROUTER_API_KEY", "")
    if key:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                resp.raise_for_status()
                all_models = resp.json().get("data", [])
                or_models = [
                    {
                        "id": m["id"],
                        "name": m.get("name", m["id"]),
                        "free": ":free" in m["id"],
                        "context_length": m.get("context_length"),
                    }
                    for m in all_models
                ]
        except Exception as e:
            or_note = f"Live fetch failed: {e}. Check OPENROUTER_API_KEY."
    else:
        or_note = "OPENROUTER_API_KEY not set."

    return {
        "huggingface": {
            "models": hf_models,
            "count": len(hf_models),
            "note": hf_note,
        },
        "openrouter": {
            # Free models sorted first, then alphabetically within each tier
            "models": sorted(
                or_models,
                key=lambda x: (not x["free"], x["id"])
            ),
            "count": len(or_models),
            "note": or_note,
        },
        "recommended": {
            "default_inference": "HuggingFaceH4/zephyr-7b-beta",
            "default_judge": "meta-llama/Meta-Llama-3-70B-Instruct",
            "best_free_judge": "meta-llama/llama-3.3-70b-instruct:free",
            "best_paid_judge": "anthropic/claude-3.5-sonnet",
            "reasoning_judge": "deepseek-ai/DeepSeek-R1",
            "safeguard_judge": "openai/gpt-oss-safeguard-20b",
        }
    }