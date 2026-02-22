import type { PromptConfig, TestCase, RunResult } from "../components/EvalContext";
import { evaluateOutput, type EvalOptions } from "./hybridEval";

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
      const retried = false;
      let output = "";

if (useRealAPI) {
  try {
    const response = await fetch("/.netlify/functions/run_llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptConfig, testCase: tc, runNumber: run }),
    });

    if (!response.ok) throw new Error(`Serverless function failed: ${response.status}`);
    const data = await response.json();
    output = data.output ?? "";

    let llmCheck: "TRUE" | "FALSE" | undefined = undefined;
    let llmCheckPass: "TRUE" | "FALSE" | undefined = undefined;
    let llmReason: string | undefined = undefined;

    if (tc.useLLMCheck) {
      try {
        const checkResp = await fetch("/.netlify/functions/semantic_check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: promptConfig.modelName,
            output,
            expected: tc.expectedOutput,
          }),
        });

        if (checkResp.ok) {
          const checkData = await checkResp.json();
          llmCheck = checkData.llmCheck ?? "FALSE";
          llmCheckPass = llmCheck === "TRUE" ? "TRUE" : "FALSE";
          llmReason = checkData.reason ?? "No explanation provided";
        } else {
          llmCheck = "FALSE";
          llmCheckPass = "FALSE";
          llmReason = `Semantic check failed: ${checkResp.status}`;
        }
      } catch (err) {
        llmCheck = "FALSE";
        llmCheckPass = "FALSE";
        llmReason = `Semantic check failed: ${(err as Error).message}`;
      }
    }

    allResults.push({
      testCaseId: tc.id,
      output,
      latency: Math.round(performance.now() - start),
      retried,
      runNumber: run,
      deterministicCheck: data.deterministicCheck,
      deterministicCheckPass: data.deterministicCheckPass,
      normalisedCheck: data.normalisedCheck,
      normalisedCheckPass: data.normalisedCheckPass,
      llmCheck,
      llmCheckPass,
      llmReason,
      reason: [
        data.reason,
        llmCheckPass ? `LLM: ${llmCheckPass} (${llmReason})` : null,
      ].filter(Boolean).join("; "),
    });
    completedRuns++;

onProgress?.({
  testCaseIndex: tcIndex,
  runNumber: run,
  completedRuns,
  totalRuns,
});
  } catch (err) {
    allResults.push({
      testCaseId: tc.id,
      output: "",
      latency: Math.round(performance.now() - start),
      retried,
      runNumber: run,
      deterministicCheck: undefined,
      deterministicCheckPass: "FALSE",
      normalisedCheck: undefined,
      normalisedCheckPass: "FALSE",
      llmCheck: "FALSE",
      llmCheckPass: "FALSE",
      llmReason: `Run LLM failed: ${(err as Error).message}`,
      reason: `Run LLM failed: ${(err as Error).message}`,
    });
    completedRuns++;

onProgress?.({
  testCaseIndex: tcIndex,
  runNumber: run,
  completedRuns,
  totalRuns,
});
  }

  continue;
}

      const options = [
        `Result A for "${tc.input}"`,
        `Result B for "${tc.input}"`,
        `Result C for "${tc.input}"`,
      ];
      output = options[Math.floor(Math.random() * options.length)];

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
        retried,
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
    }
  }

  return allResults;
};