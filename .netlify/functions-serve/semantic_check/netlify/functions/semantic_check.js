var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/semantic_check.ts
var semantic_check_exports = {};
__export(semantic_check_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(semantic_check_exports);
async function callHFRouter(model, systemPrompt, userPrompt, temperature, maxTokens, token) {
  const modelId = model.includes(":") ? model : `${model}:featherless-ai`;
  const payload = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature,
    max_tokens: maxTokens
  };
  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF Router Error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { model, output, expected } = body;
    if (!model || !output || !expected) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          llmCheck: "FALSE",
          reason: "Missing required fields: model, output, or expected"
        })
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
          reason: `HF Router call failed: ${err.message}`
        })
      };
    }
    const llmCheck = raw.trim().toLowerCase().startsWith("y") ? "TRUE" : "FALSE";
    const reason = raw.replace(/^Yes:?,?\s*|^No:?,?\s*/i, "").trim() || "No explanation provided";
    return {
      statusCode: 200,
      body: JSON.stringify({ llmCheck, reason })
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        llmCheck: "FALSE",
        reason: `Semantic check failed: ${err.message}`
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=semantic_check.js.map
