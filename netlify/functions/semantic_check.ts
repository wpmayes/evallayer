import type { Handler } from "@netlify/functions";

interface SemanticCheckRequest {
  model: string;
  output: string;
  expected: string;
}

interface SemanticCheckResponse {
  llmCheck: "TRUE" | "FALSE";
  reason: string;
}

async function callHFRouter(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  token: string
): Promise<string> {
  const modelId = model.includes(":") ? model : `${model}:featherless-ai`;

  const payload = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF Router Error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export const handler: Handler = async (event) => {
  try {
    const body: SemanticCheckRequest = JSON.parse(event.body || "{}");
    const { model, output, expected } = body;

    if (!model || !output || !expected) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          llmCheck: "FALSE",
          reason: "Missing required fields: model, output, or expected",
        } as SemanticCheckResponse),
      };
    }

    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("Missing HF_TOKEN environment variable");

    const prompt = `
Output from LLM:
${output}

Expected answer:
${expected}

Does the output correctly provide the expected answer?
Answer ONLY with Yes or No and briefly explain.
`;

    let raw = "";
    try {
      raw = await callHFRouter(
        model,
        "You are a strict evaluator. Answer Yes or No, then explain briefly.",
        prompt,
        0,
        150,
        hfToken
      );
    } catch (err) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          llmCheck: "FALSE",
          reason: `HF Router call failed: ${(err as Error).message}`,
        } as SemanticCheckResponse),
      };
    }

    const llmCheck: "TRUE" | "FALSE" =
      raw.trim().toLowerCase().startsWith("y") ? "TRUE" : "FALSE";

    const reason =
      raw.replace(/^Yes:?\s*|^No:?\s*/i, "").trim() || "No explanation provided";

    return {
      statusCode: 200,
      body: JSON.stringify({ llmCheck, reason } as SemanticCheckResponse),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        llmCheck: "FALSE",
        reason: `Semantic check failed: ${(err as Error).message}`,
      } as SemanticCheckResponse),
    };
  }
};