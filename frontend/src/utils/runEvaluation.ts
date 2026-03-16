import type { PromptConfig, TestCase, RunResult } from "../components/EvalContext";
import { evaluateOutput, type EvalOptions } from "./hybridEval";
import { API_BASE_URL } from "../config";

interface RunEvaluationArgs {
  promptConfig: PromptConfig;
  testCases: TestCase[];
  useRealAPI?: boolean;
  evalOptions?: EvalOptions;
  onProgress?: (info: {
    testCaseIndex: number;
    runNumber: number;
    completedRuns: number;
    totalRuns: number;
  }) => void;
}

export const runEvaluation = async ({
  promptConfig,
  testCases,
  useRealAPI = true,
  evalOptions = {},
  onProgress,
}: RunEvaluationArgs): Promise<RunResult[]> => {
  const allResults: RunResult[] = [];
  const totalRuns = testCases.length * promptConfig.runsPerCase;
  let completedRuns = 0;

  for (let tcIndex = 0; tcIndex < testCases.length; tcIndex++) {
    const tc = testCases[tcIndex];

    for (let run = 1; run <= promptConfig.runsPerCase; run++) {
      const start = performance.now();

      if (useRealAPI) {
        try {
          // Build user message from template
          const userMessage = promptConfig.userTemplate.replace("{{input}}", tc.input);

          // ── Primary inference ─────────────────────────────────────────────
          const response = await fetch(`${API_BASE_URL}/inference/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: promptConfig.provider ?? "huggingface",
              model_id: promptConfig.modelName,
              system_prompt: promptConfig.systemPrompt,
              user_message: userMessage,
              temperature: promptConfig.temperature,
              max_tokens: promptConfig.maxTokens,
            }),
          });

          if (!response.ok) throw new Error(`Backend error: ${response.status}`);
          const data = await response.json();
          const output = data.output ?? "";

          // ── Deterministic + normalised checks (client-side) ───────────────
          const evalResult = await evaluateOutput(output, tc.expectedOutput, {
            strict: tc.strict ?? false,
            allowNormalized: tc.allowNormalized ?? true,
            useLLMCheck: false, // handled separately below
          });

          // ── LLM judge (optional, server-side via backend) ─────────────────
          let llmCheck: "TRUE" | "FALSE" | undefined = undefined;
          let llmCheckPass: "TRUE" | "FALSE" | undefined = undefined;
          let llmReason: string | undefined = undefined;

          if (tc.useLLMCheck && promptConfig.judgeModelName) {
            const judgePrompt = `You are an evaluation judge.

Expected criteria:
${tc.expectedOutput}

LLM output to evaluate:
${output}

Respond with a JSON object only, no markdown, no preamble:
{"pass": true, "reason": "brief explanation of why the output meets the criteria"}
or
{"pass": false, "reason": "brief explanation of why the output does not meet the criteria"}`;

            try {
              const judgeResp = await fetch(`${API_BASE_URL}/inference/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  provider: promptConfig.judgeProvider ?? "huggingface",
                  model_id: promptConfig.judgeModelName,
                  system_prompt: "You are a strict evaluation judge. Respond only with valid JSON containing 'pass' (boolean) and 'reason' (string). No markdown, no preamble, no explanation outside the JSON.",
                  user_message: judgePrompt,
                  temperature: 0.0,
                  max_tokens: 150,
                }),
              });

              if (judgeResp.ok) {
                const judgeData = await judgeResp.json();
                const cleaned = (judgeData.output ?? "")
                  .replace(/```json\s*/i, "")
                  .replace(/```/g, "")
                  .trim();

                try {
                  const parsed = JSON.parse(cleaned);
                  const passed = parsed.pass === true || parsed.pass === "true";
                  llmCheck = passed ? "TRUE" : "FALSE";
                  llmCheckPass = passed ? "TRUE" : "FALSE";
                  llmReason = typeof parsed.reason === "string" && parsed.reason.trim()
                    ? parsed.reason.trim()
                    : "No reason provided";
                } catch {
                  // Fallback if JSON parse fails
                  const fallback = cleaned.toLowerCase().includes('"pass":true') ||
                    cleaned.toLowerCase().includes('"pass": true');
                  llmCheck = fallback ? "TRUE" : "FALSE";
                  llmCheckPass = llmCheck;
                  llmReason = `JSON parse failed. Raw: ${cleaned.slice(0, 100)}`;
                }
              } else {
                llmCheck = "FALSE";
                llmCheckPass = "FALSE";
                llmReason = `Judge request failed: ${judgeResp.status}`;
              }
            } catch (err) {
              llmCheck = "FALSE";
              llmCheckPass = "FALSE";
              llmReason = `Judge call failed: ${(err as Error).message}`;
            }
          }

          // ── Rebuild reason string with all checks ─────────────────────────
          const reasonParts = [
            evalResult.deterministicCheckPass
              ? `Deterministic: ${evalResult.deterministicCheckPass}`
              : null,
            evalResult.normalisedCheckPass
              ? `Normalised: ${evalResult.normalisedCheckPass}`
              : null,
            llmCheckPass
              ? `LLM: ${llmCheckPass}${llmReason ? ` (${llmReason})` : ""}`
              : null,
          ].filter(Boolean);

          const reason = reasonParts.join("; ") || "Failed all checks";

          allResults.push({
            testCaseId: tc.id,
            output,
            latency: Math.round(performance.now() - start),
            retried: false,
            runNumber: run,
            deterministicCheck: evalResult.deterministicCheck,
            deterministicCheckPass: evalResult.deterministicCheckPass,
            normalisedCheck: evalResult.normalisedCheck,
            normalisedCheckPass: evalResult.normalisedCheckPass,
            llmCheck,
            llmCheckPass,
            llmReason,
            reason,
            promptTokens: data.prompt_tokens ?? 0,
            completionTokens: data.completion_tokens ?? 0,
            totalTokens: data.total_tokens ?? 0,
            estimatedCostUsd: 0,
          });

        } catch (err) {
          allResults.push({
            testCaseId: tc.id,
            output: "",
            latency: Math.round(performance.now() - start),
            retried: false,
            runNumber: run,
            deterministicCheck: undefined,
            deterministicCheckPass: "FALSE",
            normalisedCheck: undefined,
            normalisedCheckPass: "FALSE",
            llmCheck: "FALSE",
            llmCheckPass: "FALSE",
            llmReason: `Backend call failed: ${(err as Error).message}`,
            reason: `Backend call failed: ${(err as Error).message}`,
          });
        }

        completedRuns++;
        onProgress?.({ testCaseIndex: tcIndex, runNumber: run, completedRuns, totalRuns });
        continue;
      }

      // ── Mock mode (no API) ────────────────────────────────────────────────
      const options = [
        `Result A for "${tc.input}"`,
        `Result B for "${tc.input}"`,
        `Result C for "${tc.input}"`,
      ];
      const output = options[Math.floor(Math.random() * options.length)];

      const evalResult = await evaluateOutput(output, tc.expectedOutput, {
        ...evalOptions,
        strict: tc.strict ?? false,
        allowNormalized: tc.allowNormalized ?? true,
        useLLMCheck: tc.useLLMCheck ?? false,
      });

      allResults.push({
        testCaseId: tc.id,
        output,
        latency: Math.round(performance.now() - start),
        retried: false,
        runNumber: run,
        deterministicCheck: evalResult.deterministicCheck,
        deterministicCheckPass: evalResult.deterministicCheckPass,
        normalisedCheck: evalResult.normalisedCheck,
        normalisedCheckPass: evalResult.normalisedCheckPass,
        llmCheck: evalResult.llmCheck,
        llmCheckPass: evalResult.llmCheckPass,
        llmReason: evalResult.llmReason,
        reason: evalResult.reason,
      });

      completedRuns++;
      onProgress?.({ testCaseIndex: tcIndex, runNumber: run, completedRuns, totalRuns });
    }
  }

  return allResults;
};