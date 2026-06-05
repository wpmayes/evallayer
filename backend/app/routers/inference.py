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
from app.services.llm_providers import run_inference
from app.services import model_registry

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
    return await model_registry.list_models()