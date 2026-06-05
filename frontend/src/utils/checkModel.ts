import { API_BASE_URL } from "../config";

/**
 * Pre-flight availability check for a model.
 *
 * A model appearing in /inference/models only means HF Router advertises it —
 * not that the provider routing the evaluator uses can actually serve it. The
 * only reliable signal is a real (tiny) inference through the same path a run
 * takes, so a green result genuinely means "this will run".
 *
 * Reuses the existing /inference/complete endpoint with max_tokens: 1, so no
 * backend change is required.
 */
export type CheckState = "available" | "unavailable" | "busy" | "error";

export interface CheckResult {
  state: CheckState;
  latencyMs?: number;
  message?: string;
}

export async function checkModel(provider: string, modelId: string): Promise<CheckResult> {
  try {
    const resp = await fetch(`${API_BASE_URL}/inference/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model_id: modelId,
        system_prompt: "ping",
        user_message: "Reply with the single word: ok",
        temperature: 0,
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (resp.ok) {
      const data = await resp.json();
      return { state: "available", latencyMs: Math.round(data.latency_ms ?? 0) };
    }

    // FastAPI returns { detail: "..." } on error.
    const detail = await resp.json().catch(() => null);
    const message = detail?.detail ?? `HTTP ${resp.status}`;

    // 429 = the model exists but is rate limited right now, not unavailable.
    if (resp.status === 429) {
      return { state: "busy", message: "Rate limited — available, try again shortly" };
    }
    // 400 = bad request / unknown model / missing key — genuinely won't run.
    if (resp.status === 400) {
      return { state: "unavailable", message };
    }
    // 502 etc — upstream/provider problem.
    return { state: "error", message };
  } catch (err) {
    const name = (err as Error)?.name;
    return {
      state: "error",
      message: name === "TimeoutError" ? "Timed out — provider slow or unavailable" : "Couldn't reach backend",
    };
  }
}
