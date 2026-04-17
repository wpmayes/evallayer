/**
 * runEvaluation.ts
 *
 * Fires a backend Run for a given suite + prompt config, polls until
 * complete, and maps backend Result rows back to frontend RunResult shape.
 *
 * Key fix: createBackendSuite() now returns a backendToFrontendId map so
 * the caller can translate backend test_case_id → frontend tc.id.
 * Without this, EvaluationResultsPanel's lookups all return undefined and
 * every metric (pass rate, CI, CSV export) shows zero / empty.
 */

import { API_BASE_URL } from "../config";
import type { PromptConfig, TestCase, RunResult } from "../components/EvalContext";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackendResult {
  id: number;
  run_id: number;
  test_case_id: number;
  actual_output: string;
  strict_passed: boolean | null;
  normalised_passed: boolean | null;
  llm_passed: boolean | null;
  passed: boolean;
  reason: string | null;
  latency_ms: number;
  raw_response: Record<string, unknown>;
  created_at: string;
}

interface BackendRun {
  id: number;
  status: string;
  total_cases: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_latency_ms: number;
}

export interface RunEvaluationArgs {
  suiteId: number;
  /** Maps backend test_case_id → frontend tc.id */
  backendToFrontendId: Record<number, number>;
  promptConfig: PromptConfig;
  testCases: TestCase[];
  onProgress?: (info: {
    status: string;
    completed: number;
    total: number;
    label?: string;
  }) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapResult(
  r: BackendResult,
  backendToFrontendId: Record<number, number>,
  runNumber = 1,
): RunResult {
  // Extract LLM judge reason from composite reason string.
  // Backend format: "[normalised] ...\n[llm] some reason text"
  const llmReasonMatch = r.reason?.match(/\[llm\]\s*(.+)/s);
  const llmReason = llmReasonMatch ? llmReasonMatch[1].trim() : undefined;

  return {
    // Translate backend ID → frontend ID so panel lookups work
    testCaseId: backendToFrontendId[r.test_case_id] ?? r.test_case_id,
    output: r.actual_output,
    latency: r.latency_ms,
    retried: false,
    runNumber,

    deterministicCheckPass:
      r.strict_passed === null ? undefined : r.strict_passed ? "TRUE" : "FALSE",
    normalisedCheckPass:
      r.normalised_passed === null ? undefined : r.normalised_passed ? "TRUE" : "FALSE",
    llmCheckPass:
      r.llm_passed === null ? undefined : r.llm_passed ? "TRUE" : "FALSE",
    llmReason,
    reason: r.reason ?? undefined,
  };
}

async function startRun(
  suiteId: number,
  modelId: string,
  provider: string,
  label: string,
  temperature: number,
  maxTokens: number,
): Promise<number> {
  console.log("startRun →", { suiteId, modelId, provider });

  const resp = await fetch(`${API_BASE_URL}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      suite_id: suiteId,
      model_id: modelId,
      provider,
      label,
      run_config: { temperature, max_tokens: maxTokens },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Failed to start run: ${detail}`);
  }

  const run: BackendRun = await resp.json();
  return run.id;
}

async function pollUntilComplete(
  runId: number,
  onProgress?: RunEvaluationArgs["onProgress"],
  label?: string,
): Promise<{ run: BackendRun; results: BackendResult[] }> {
  while (true) {
    const resp = await fetch(`${API_BASE_URL}/runs/${runId}`);
    if (!resp.ok) throw new Error(`Failed to fetch run ${runId}`);

    const data = await resp.json();
    const run: BackendRun = data.run;

    // completed = cases that have a result (passed + failed)
    const completed = run.passed + run.failed;

    onProgress?.({
      status: run.status,
      completed,
      total: run.total_cases,
      label,
    });

    if (run.status === "complete" || run.status === "error") {
      return { run, results: data.results as BackendResult[] };
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export const runEvaluation = async ({
  suiteId,
  backendToFrontendId,
  promptConfig,
  onProgress,
}: RunEvaluationArgs): Promise<RunResult[]> => {
  const {
    modelName,
    provider = "huggingface",
    comparisonModelName,
    comparisonProvider = "huggingface",
    temperature,
    maxTokens,
  } = promptConfig;

  // Primary run
  const primaryRunId = await startRun(
    suiteId, modelName, provider,
    `${modelName.split("/").pop()} (primary)`,
    temperature, maxTokens,
  );

  const { results: primaryResults } = await pollUntilComplete(
    primaryRunId, onProgress, "Primary",
  );

  const mapped = primaryResults.map((r) => mapResult(r, backendToFrontendId, 1));

  // Optional comparison run
  if (comparisonModelName) {
    const compRunId = await startRun(
      suiteId, comparisonModelName, comparisonProvider,
      `${comparisonModelName.split("/").pop()} (comparison)`,
      temperature, maxTokens,
    );

    const { results: compResults } = await pollUntilComplete(
      compRunId, onProgress, "Comparison",
    );

    mapped.push(...compResults.map((r) => mapResult(r, backendToFrontendId, 2)));
  }

  return mapped;
};

/**
 * compareRuns — fetches the regression/fix diff between two backend runs.
 */
export const compareRuns = async (runAId: number, runBId: number) => {
  const resp = await fetch(`${API_BASE_URL}/runs/compare/${runAId}/${runBId}`);
  if (!resp.ok) throw new Error("Failed to compare runs");
  return resp.json();
};