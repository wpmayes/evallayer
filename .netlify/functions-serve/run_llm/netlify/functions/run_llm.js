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

// netlify/functions/run_llm.ts
var run_llm_exports = {};
__export(run_llm_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(run_llm_exports);

// src/utils/hybridEval.ts
async function evaluateOutput(output, expected, options = {}) {
  const {
    strict = false,
    allowNormalized = false,
    allowedVariants = [],
    regexVariants = [],
    useLLMCheck = false,
    llmCheckFn
  } = options;
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  const actual = output.trim();
  const expectedTrimmed = expected?.trim();
  if (!expectedTrimmed) {
    return {
      deterministicCheck: void 0,
      deterministicCheckPass: "TRUE",
      normalisedCheck: void 0,
      normalisedCheckPass: "TRUE",
      overallPassed: true,
      reason: "No expected output"
    };
  }
  const deterministicCheck = strict ? "TRUE" : void 0;
  let deterministicCheckPass = void 0;
  if (strict && actual === expectedTrimmed) {
    deterministicCheckPass = "TRUE";
  } else if (strict) {
    deterministicCheckPass = "FALSE";
  }
  const normalisedCheck = allowNormalized ? "TRUE" : void 0;
  let normalisedCheckPass = void 0;
  if (allowNormalized) {
    normalisedCheckPass = normalize(actual).includes(normalize(expectedTrimmed)) || allowedVariants.some((v) => normalize(actual).includes(normalize(v))) || regexVariants.some((rx) => rx.test(actual)) ? "TRUE" : "FALSE";
  }
  let llmCheck;
  let llmCheckPass;
  let llmReason;
  if (useLLMCheck && llmCheckFn) {
    try {
      const result = await llmCheckFn(output, expectedTrimmed);
      llmCheck = result.llmCheck;
      llmCheckPass = result.llmCheck === "TRUE" ? "TRUE" : "FALSE";
      llmReason = result.reason;
    } catch (err) {
      llmCheck = "FALSE";
      llmCheckPass = "FALSE";
      llmReason = `LLM check failed: ${err.message}`;
    }
  }
  const overallPassed = (!strict || deterministicCheckPass === "TRUE") && (!allowNormalized || normalisedCheckPass === "TRUE") && (!useLLMCheck || llmCheckPass === "TRUE");
  const reasonParts = [
    deterministicCheckPass ? `Deterministic: ${deterministicCheckPass}` : null,
    normalisedCheckPass ? `Normalised: ${normalisedCheckPass}` : null,
    llmCheckPass ? `LLM: ${llmCheckPass}${llmReason ? ` (${llmReason})` : ""}` : null
  ].filter(Boolean);
  return {
    deterministicCheck,
    deterministicCheckPass,
    normalisedCheck,
    normalisedCheckPass,
    llmCheck,
    llmCheckPass,
    llmReason,
    overallPassed,
    reason: reasonParts.join("; ") || "Failed all checks"
  };
}

// netlify/functions/run_llm.ts
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
  const start = Date.now();
  let retried = false;
  try {
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("Missing HF_TOKEN environment variable");
    const body = JSON.parse(event.body || "{}");
    const { promptConfig, testCase, runNumber } = body;
    const userPrompt = promptConfig.userTemplate.replace("{{input}}", testCase.input);
    let output = "";
    try {
      output = await callHFRouter(
        promptConfig.modelName,
        promptConfig.systemPrompt,
        userPrompt,
        Math.min(promptConfig.temperature, 1),
        Math.min(promptConfig.maxTokens, 1024),
        hfToken
      );
    } catch (err) {
      const errMsg = err.message;
      if (promptConfig.retryOnInvalid && errMsg.includes("HF Router Error")) {
        retried = true;
        try {
          output = await callHFRouter(
            promptConfig.modelName,
            promptConfig.systemPrompt,
            userPrompt,
            Math.min(promptConfig.temperature, 1),
            Math.min(promptConfig.maxTokens, 1024),
            hfToken
          );
        } catch (err2) {
          output = `Error after retry: ${err2.message}`;
          retried = false;
        }
      } else {
        output = `Error: ${errMsg}`;
      }
    }
    let validJson = false;
    try {
      JSON.parse(output);
      validJson = true;
    } catch {
      validJson = false;
    }
    const evalOptions = {
      strict: testCase.strict ?? false,
      allowNormalized: testCase.allowNormalized ?? true,
      useLLMCheck: testCase.useLLMCheck ?? false
    };
    const evalResult = await evaluateOutput(output, testCase.expectedOutput, evalOptions);
    const result = {
      testCaseId: testCase.id,
      input: testCase.input,
      output,
      passed: evalResult.overallPassed,
      reason: evalResult.reason,
      validJson,
      retried,
      latency: Date.now() - start,
      runNumber,
      deterministicCheck: evalResult.deterministicCheck,
      deterministicCheckPass: evalResult.deterministicCheckPass,
      normalisedCheck: evalResult.normalisedCheck,
      normalisedCheckPass: evalResult.normalisedCheckPass,
      llmCheck: evalResult.llmCheck,
      llmReason: evalResult.llmReason
    };
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=run_llm.js.map
