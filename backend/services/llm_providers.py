"""
Inference service; abstracts over multiple LLM providers.

Providers supported:
  huggingface  — Hugging Face Serverless Inference API
  openrouter   — OpenRouter aggregator (access to 100+ models incl. frontier)
  ollama       — Local Ollama instance (for development, zero cost)

"""
import os
import time
import httpx
from typing import Optional

HF_API_URL = "https://api-inference.huggingface.co/models"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OLLAMA_API_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")

HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN", "")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")


class InferenceResult:
    def __init__(self, output: str, latency_ms: float, raw: dict):
        self.output = output
        self.latency_ms = latency_ms
        self.raw = raw


async def _call_huggingface(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Calls the HuggingFace Router API.
    Model ID format: "owner/model"
    """
    token = os.getenv("HUGGINGFACE_TOKEN", "")
    if not token:
        raise ValueError("HUGGINGFACE_TOKEN not set")
    model_with_provider = model_id if ":" in model_id else f"{model_id}:featherless-ai"
    
    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_with_provider,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": min(temperature, 1.0),
        "max_tokens": min(max_tokens, 1024),
    }
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
    latency_ms = (time.monotonic() - t0) * 1000
    data = resp.json()
    output = data["choices"][0]["message"]["content"]
    return InferenceResult(output=output, latency_ms=latency_ms, raw=data)


async def _call_openrouter(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        raise ValueError("OPENROUTER_API_KEY not set")

    url = "https://openrouter.ai/api/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {key}",
        "HTTP-Referer": "https://evallayer.netlify.app",
        "X-Title": "EvalLayer",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
    latency_ms = (time.monotonic() - t0) * 1000
    data = resp.json()
    output = data["choices"][0]["message"]["content"]
    return InferenceResult(output=output, latency_ms=latency_ms, raw=data)

async def _call_ollama(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Calls a local Ollama instance.
    Install Ollama: https://ollama.com
    Pull a model: ollama pull mistral
    Useful model IDs: mistral, llama3, llama3:70b, phi3
    """
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "options": {"temperature": temperature, "num_predict": max_tokens},
        "stream": False,
    }
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(OLLAMA_API_URL, json=payload)
        resp.raise_for_status()
    latency_ms = (time.monotonic() - t0) * 1000
    data = resp.json()
    output = data["message"]["content"]
    return InferenceResult(output=output, latency_ms=latency_ms, raw=data)


# ── Provider registry ──────────────────────────────────────────────────────────

PROVIDER_MAP = {
    "huggingface": _call_huggingface,
    "openrouter": _call_openrouter,
    "ollama": _call_ollama,
}


async def run_inference(
    provider: str,
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Main entry point. 
    """
    if provider not in PROVIDER_MAP:
        raise ValueError(f"Unknown provider '{provider}'. Choose from: {list(PROVIDER_MAP.keys())}")
    fn = PROVIDER_MAP[provider]
    return await fn(
        model_id=model_id,
        system_prompt=system_prompt,
        user_message=user_message,
        temperature=temperature,
        max_tokens=max_tokens,
    )
