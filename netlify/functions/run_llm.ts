import 'dotenv/config';
import type { Handler } from "@netlify/functions";
import type { EvalOptions } from "../../src/utils/hybridEval";
import { evaluateOutput } from "../../src/utils/hybridEval";

interface RunLLMRequest {
  promptConfig: {
    modelName: string;
    systemPrompt: string;
    userTemplate: string;
    temperature: number;
    maxTokens: number;
    retryOnInvalid: boolean;
  };
  testCase: {
    id: number;
    input: string;
    expectedOutput?: string;
    strict?: boolean;
    allowNormalized?: boolean;
    useLLMCheck?: boolean;
  };
  runNumber: number;
}

interface RunLLMResult {
  testCaseId: number;
  input: string;
  output: string;

  passed: boolean;
  reason: string;
  validJson: boolean;
  retried: boolean;
  latency: number;
  runNumber: number;
  llmCheck?: "TRUE" | "FALSE";
  llmReason?: string;
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
  const start = Date.now();
  let retried = false;

  try {
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("Missing HF_TOKEN environment variable");

    const body: RunLLMRequest = JSON.parse(event.body || "{}");
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
      const errMsg = (err as Error).message;

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
          output = `Error after retry: ${(err2 as Error).message}`;
          retried = false;
        }
      } else {
        output = `Error: ${errMsg}`;
      }
    }

    let validJson = false;
    try { JSON.parse(output); validJson = true; } catch { validJson = false; }

    const evalOptions: EvalOptions = {
      strict: testCase.strict ?? false,
      allowNormalized: testCase.allowNormalized ?? true,
      useLLMCheck: testCase.useLLMCheck ?? false,
    };
    const evalResult = await evaluateOutput(output, testCase.expectedOutput, evalOptions);

    const result: RunLLMResult = {
      testCaseId: testCase.id,
      input: testCase.input,
      output,
      passed: evalResult.overallPassed, // ✅ updated
      reason: evalResult.reason,
      validJson,
      retried,
      latency: Date.now() - start,
      runNumber,
      llmCheck: evalResult.llmCheck,
      llmReason: evalResult.llmReason,
    };

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: (err as Error).message }) };
  }
};
