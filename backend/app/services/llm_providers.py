"""
Inference service — abstracts over multiple LLM providers.

Providers supported:
  huggingface  — Hugging Face Router (serverless, featherless-ai backend)
  openrouter   — OpenRouter aggregator (100+ models incl. frontier)
  ollama       — Local Ollama instance (development / offline, zero cost)

Retry behaviour
───────────────
_call_with_retry() wraps every provider call. On a 429 it waits and retries
up to MAX_RETRIES times with linear backoff (BACKOFF_BASE * attempt seconds).
All other HTTP errors are re-raised immediately — retrying a 400 or 402
would not help.

The retry happens INSIDE the provider function, before the exception propagates
up to the run worker. This means the worker's try/except only sees a failure
after all retries are exhausted, not on the first 429.
"""
import os
import time
import asyncio
import httpx

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OLLAMA_API_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")

MAX_RETRIES = 3    # attempts after the first failure (so 4 total)
BACKOFF_BASE = 8   # seconds — wait = BACKOFF_BASE * attempt
                   # attempt 1 → 8s, attempt 2 → 16s, attempt 3 → 24s


class InferenceResult:
    def __init__(self, output: str, latency_ms: float, raw: dict):
        self.output = output
        self.latency_ms = latency_ms
        self.raw = raw


# ── Retry wrapper ──────────────────────────────────────────────────────────────

async def _call_with_retry(fn) -> InferenceResult:
    """
    Calls an async zero-argument callable with automatic retry on 429s.

    fn must be a zero-argument coroutine factory, i.e. an inner async def
    that closes over its arguments:

        async def _inner():
            ...
        return await _call_with_retry(_inner)

    Only 429 Too Many Requests triggers a retry. All other HTTP errors
    (400, 402, 5xx) are re-raised immediately on the first occurrence.
    After MAX_RETRIES retries, the final 429 is re-raised so the caller
    can handle it (the run worker will record it as an error result).
    """
    for attempt in range(1, MAX_RETRIES + 2):  # attempts 1..MAX_RETRIES+1
        try:
            return await fn()
        except httpx.HTTPStatusError as exc:
            is_last_attempt = attempt > MAX_RETRIES
            if exc.response.status_code == 429 and not is_last_attempt:
                wait = BACKOFF_BASE * attempt
                print(
                    f"[429] Rate limited (attempt {attempt}/{MAX_RETRIES + 1})"
                    f" — retrying in {wait}s..."
                )
                await asyncio.sleep(wait)
            else:
                # Non-retriable error, or out of retries — propagate up
                raise


# ── HuggingFace Router ─────────────────────────────────────────────────────────

async def _call_huggingface(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Calls the HuggingFace Router API (router.huggingface.co).

    Model ID format: "owner/model"
    Suffix controls backend routing:
      :featherless-ai  — confirmed working on free tier (default)
      :together        — Together AI backend
      :cheapest        — lowest-cost available provider
      :fastest         — documented but unreliable on the free tier

    Examples:
      "HuggingFaceH4/zephyr-7b-beta"                  → featherless-ai
      "HuggingFaceH4/zephyr-7b-beta:together"         → explicit backend
      "meta-llama/Llama-3-70b-instruct:cheapest"      → cheapest backend
    """
    token = os.getenv("HUGGINGFACE_TOKEN", "")
    if not token:
        raise ValueError("HUGGINGFACE_TOKEN not set")

    # Default to :featherless-ai — confirmed working; :fastest is unreliable
    model_with_provider = (
        model_id if ":" in model_id else f"{model_id}:featherless-ai"
    )

    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {token}",
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

    async def _inner() -> InferenceResult:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
        latency_ms = (time.monotonic() - t0) * 1000
        data = resp.json()
        output = data["choices"][0]["message"]["content"]
        return InferenceResult(output=output, latency_ms=latency_ms, raw=data)

    return await _call_with_retry(_inner)


# ── OpenRouter ─────────────────────────────────────────────────────────────────

async def _call_openrouter(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Calls OpenRouter — access to 100+ models with a single API key.
    Free models have ":free" in their ID.
    Set OPENROUTER_API_KEY in your environment.
    """
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        raise ValueError("OPENROUTER_API_KEY not set")

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

    async def _inner() -> InferenceResult:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(OPENROUTER_API_URL, headers=headers, json=payload)
            resp.raise_for_status()
        latency_ms = (time.monotonic() - t0) * 1000
        data = resp.json()
        output = data["choices"][0]["message"]["content"]
        return InferenceResult(output=output, latency_ms=latency_ms, raw=data)

    return await _call_with_retry(_inner)


# ── Ollama (local) ─────────────────────────────────────────────────────────────

async def _call_ollama(
    model_id: str,
    system_prompt: str,
    user_message: str,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> InferenceResult:
    """
    Calls a local Ollama instance — free, no API key, runs offline.
    Install: https://ollama.com  |  Pull a model: ollama pull mistral
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

    async def _inner() -> InferenceResult:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(OLLAMA_API_URL, json=payload)
            resp.raise_for_status()
        latency_ms = (time.monotonic() - t0) * 1000
        data = resp.json()
        output = data["message"]["content"]
        return InferenceResult(output=output, latency_ms=latency_ms, raw=data)

    return await _call_with_retry(_inner)


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
    Main entry point — dispatches to the correct provider.
    Retry logic is handled inside each provider via _call_with_retry().
    """
    if provider not in PROVIDER_MAP:
        raise ValueError(
            f"Unknown provider {provider!r}. "
            f"Choose from: {list(PROVIDER_MAP.keys())}"
        )
    return await PROVIDER_MAP[provider](
        model_id=model_id,
        system_prompt=system_prompt,
        user_message=user_message,
        temperature=temperature,
        max_tokens=max_tokens,
    )