import { useState } from "react";
import { useEval } from "./EvalContext";
import { wilsonCI, consistencyScore } from "../utils/statsUtils";
import type { PerCaseStats } from "../utils/statsUtils";

interface FailureRecord {
  testCaseId: number
  input?: string
  expected?: string
  actual?: string
  reason: string
}

interface CoverageRecord {
  testCaseId: number
  runs: number
  passed: number
  failed: number
}

function truncate(text?: string, maxLength = 120) {
  if (!text) return "N/A";
  const clean = text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) + "…" : clean;
}

function formatText(text?: string) {
  if (!text) return "N/A";
  return text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function computeIsPassed(
  run: { deterministicCheckPass?: string; normalisedCheckPass?: string; llmCheckPass?: string },
  test?: { strict?: boolean; allowNormalized?: boolean; useLLMCheck?: boolean }
): boolean {
  const checks: boolean[] = [];
  if (test?.strict) checks.push(run.deterministicCheckPass === "TRUE");
  if (test?.allowNormalized) checks.push(run.normalisedCheckPass === "TRUE");
  if (test?.useLLMCheck) checks.push(run.llmCheckPass === "TRUE");
  return checks.length > 0 && checks.some(Boolean);
}

function ConsistencyBadge({ score, description }: { score: string; description: string }) {
  const color = score === "HIGH" ? "#22c55e" : score === "MEDIUM" ? "#f59e0b" : score === "LOW" ? "#ef4444" : "#64748b";
  const bg = score === "HIGH" ? "rgba(34,197,94,0.15)" : score === "MEDIUM" ? "rgba(245,158,11,0.15)" : score === "LOW" ? "rgba(239,68,68,0.12)" : "rgba(100,116,139,0.15)";
  return (
    <span title={description} style={{
      fontSize: "0.72rem", padding: "0.1rem 0.4rem", borderRadius: "4px",
      background: bg, color, cursor: "help",
    }}>
      {score}
    </span>
  );
}

export default function EvaluationResultsPanel() {
  const { evaluationResults, selectedPrompt, testCases } = useEval();
  const [showDetails, setShowDetails] = useState(true);
  const [expandedTestCases, setExpandedTestCases] = useState<number[]>([]);

  if (!evaluationResults || !selectedPrompt) {
    return (
      <div className="form-panel">
        <h2>Evaluation Results</h2>
        <div className="empty-state">
          <p>No evaluation results yet.</p>
          <span>Run an evaluation to see reliability metrics.</span>
        </div>
      </div>
    );
  }

  const { perTestCaseRuns } = evaluationResults;

  let totalRuns = 0;
  let passedRuns = 0;
  let totalLatency = 0;
  let deterministicTotal = 0;
  let deterministicPassed = 0;
  let normalizedTotal = 0;
  let normalizedPassed = 0;
  let llmTotal = 0;
  let llmPassed = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  const failures: FailureRecord[] = [];
  const coverage: CoverageRecord[] = [];

  perTestCaseRuns?.forEach(tcRun => {
    const test = testCases.find(t => t.id === tcRun.testCaseId);
    if (!test) return;

    let tcPassed = 0;
    let tcFailed = 0;

    tcRun.runs.forEach(run => {
      const passed = computeIsPassed(run, test);
      totalRuns++;
      if (passed) { passedRuns++; tcPassed++; } else tcFailed++;
      totalLatency += run.latency ?? 0;
      totalPromptTokens += run.promptTokens ?? 0;
      totalCompletionTokens += run.completionTokens ?? 0;
      totalTokens += run.totalTokens ?? 0;
      totalCostUsd += run.estimatedCostUsd ?? 0;

      if (test.strict) {
        deterministicTotal++;
        if (run.deterministicCheckPass === "TRUE") deterministicPassed++;
      }
      if (test.allowNormalized) {
        normalizedTotal++;
        if (run.normalisedCheckPass === "TRUE") normalizedPassed++;
      }
      if (test.useLLMCheck) {
        llmTotal++;
        if (run.llmCheckPass === "TRUE") llmPassed++;
      }
      if (!passed) {
        failures.push({
          testCaseId: test.id,
          input: test.input,
          expected: test.expectedOutput,
          actual: run.output,
          reason: run.reason ?? "Unknown"
        });
      }
    });

    coverage.push({ testCaseId: test.id, runs: tcRun.runs.length, passed: tcPassed, failed: tcFailed });
  });

  const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
  const avgLatency = totalRuns > 0 ? Math.round(totalLatency / totalRuns) : 0;
  const avgCostPerRun = totalRuns > 0 ? totalCostUsd / totalRuns : 0;
  const hasCostData = totalTokens > 0;
  const hasLLMCheck = llmTotal > 0;

  const deterministicPassRate = deterministicTotal > 0
    ? Math.round((deterministicPassed / deterministicTotal) * 100) : null;
  const normalizedPassRate = normalizedTotal > 0
    ? Math.round((normalizedPassed / normalizedTotal) * 100) : null;
  const llmPassRate = llmTotal > 0
    ? Math.round((llmPassed / llmTotal) * 100) : null;

  // ── Statistical analysis ──────────────────────────────────────────────
  const overallReliability = wilsonCI(passedRuns, totalRuns);
  const overallConsistency = consistencyScore(passedRuns, totalRuns);

  const perCaseStats: PerCaseStats[] = perTestCaseRuns?.map(tcRun => {
    const test = testCases.find(t => t.id === tcRun.testCaseId);
    const passes = tcRun.runs.filter(r => computeIsPassed(r, test)).length;
    return {
      testCaseId: tcRun.testCaseId,
      reliability: wilsonCI(passes, tcRun.runs.length),
      consistency: consistencyScore(passes, tcRun.runs.length),
    };
  }) ?? [];

  const hasComparison = Boolean(selectedPrompt.comparisonModelName);
  const mcnemarNote = hasComparison
    ? "Run both models separately and compare results to enable McNemar's test"
    : "Configure a comparison model to enable McNemar's test";

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const handleDownloadPromptCSV = () => {
    const headers = [
      "Prompt ID", "Prompt Name", "Model", "Provider",
      "Comparison Model", "Comparison Provider",
      "Judge Model", "Judge Provider",
      "System Prompt", "User Template",
      "Temperature", "Max Tokens", "Retry On Invalid", "Runs Per Case"
    ];
    const row = [
      selectedPrompt.id.toString(),
      selectedPrompt.name,
      selectedPrompt.modelName,
      selectedPrompt.provider ?? "huggingface",
      selectedPrompt.comparisonModelName ?? "",
      selectedPrompt.comparisonProvider ?? "",
      selectedPrompt.judgeModelName ?? "",
      selectedPrompt.judgeProvider ?? "",
      formatText(selectedPrompt.systemPrompt),
      formatText(selectedPrompt.userTemplate),
      selectedPrompt.temperature.toString(),
      selectedPrompt.maxTokens.toString(),
      selectedPrompt.retryOnInvalid ? "TRUE" : "FALSE",
      selectedPrompt.runsPerCase.toString(),
    ];
    const csvContent = [headers.join(","), row.map(v => `"${v}"`).join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `prompt_config_${timestamp}.csv`;
    link.click();
  };

  const handleDownloadResultsCSV = () => {
    const headers = [
      "Prompt ID", "Prompt Name", "Model", "Provider",
      "Judge Model", "Judge Provider",
      "Test Case ID", "Test Case Input", "Expected Output",
      "Run #", "LLM Output", "Passed", "Retry",
      "Strict", "Strict Pass",
      "Allow Normalized", "Normalized Pass",
      "LLM Check", "LLM Check Pass", "LLM Reason",
      "Reason",
      "Prompt Tokens", "Completion Tokens", "Total Tokens", "Est. Cost (USD)"
    ];
    const rows: string[][] = [];
    perTestCaseRuns?.forEach(tcRun => {
      const test = testCases.find(t => t.id === tcRun.testCaseId);
      if (!test) return;
      tcRun.runs.forEach(run => {
        const isPassed = computeIsPassed(run, test);
        rows.push([
          selectedPrompt.id.toString(),
          selectedPrompt.name,
          selectedPrompt.modelName,
          selectedPrompt.provider ?? "huggingface",
          selectedPrompt.judgeModelName ?? "N/A",
          selectedPrompt.judgeProvider ?? "N/A",
          test.id.toString(),
          formatText(test.input),
          formatText(test.expectedOutput ?? ""),
          run.runNumber.toString(),
          formatText(run.output),
          isPassed ? "TRUE" : "FALSE",
          run.retried ? "TRUE" : "FALSE",
          test.strict ? "TRUE" : "FALSE",
          run.deterministicCheckPass ?? "N/A",
          test.allowNormalized ? "TRUE" : "FALSE",
          run.normalisedCheckPass ?? "N/A",
          test.useLLMCheck ? "TRUE" : "FALSE",
          run.llmCheckPass ?? "N/A",
          formatText(run.llmReason),
          formatText(run.reason),
          run.promptTokens?.toString() ?? "",
          run.completionTokens?.toString() ?? "",
          run.totalTokens?.toString() ?? "",
          run.estimatedCostUsd?.toFixed(6) ?? "",
        ]);
      });
    });
    const csvContent = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `evaluation_results_${timestamp}.csv`;
    link.click();
  };

  const handleDownloadReport = () => {
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        datasetSize: perTestCaseRuns?.length ?? 0,
        runsPerCase: selectedPrompt.runsPerCase,
        model: selectedPrompt.modelName,
        provider: selectedPrompt.provider ?? "huggingface",
        comparisonModel: selectedPrompt.comparisonModelName ?? null,
        comparisonProvider: selectedPrompt.comparisonProvider ?? null,
        judgeModel: selectedPrompt.judgeModelName ?? null,
        judgeProvider: selectedPrompt.judgeProvider ?? null,
        temperature: selectedPrompt.temperature,
        maxTokens: selectedPrompt.maxTokens,
      },
      prompt: selectedPrompt,
      summary: {
        passRate,
        avgLatency,
        totalRuns,
        passedRuns,
      },
      statisticalAnalysis: {
        overall: {
          reliability: overallReliability,
          consistency: overallConsistency,
        },
        perTestCase: perCaseStats,
        mcnemar: {
          note: mcnemarNote,
          available: false,
        },
        methodologyNote: "Wilson score CI (95%). Consistency via Bernoulli variance. McNemar's test requires paired results from two models on identical test cases — configure a comparison model and run both to enable.",
      },
      checkPerformance: {
        deterministicPassRate,
        normalizedPassRate,
        llmPassRate,
        judgeModel: hasLLMCheck ? (selectedPrompt.judgeModelName ?? null) : null,
      },
      costSummary: hasCostData ? {
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        estimatedTotalCostUsd: totalCostUsd,
        estimatedCostPerRun: avgCostPerRun,
      } : null,
      coverage,
      failures,
      testCases: perTestCaseRuns,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `evaluation_report_${timestamp}.json`;
    link.click();
  };

  const toggleTestCase = (id: number) => {
    setExpandedTestCases(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="form-panel">
      <h2>Evaluation Results</h2>

      {/* Config summary */}
      <div style={{
        padding: "0.6rem 0.75rem", background: "#0f172a", borderRadius: "6px",
        marginBottom: "0.75rem", fontSize: "0.75rem", color: "#64748b",
        display: "flex", flexWrap: "wrap", gap: "0.75rem",
      }}>
        <span>
          <strong style={{ color: "#94a3b8" }}>Model:</strong>{" "}
          {selectedPrompt.modelName.split("/").pop()}
        </span>
        {selectedPrompt.comparisonModelName && (
          <span>
            <strong style={{ color: "#94a3b8" }}>vs:</strong>{" "}
            {selectedPrompt.comparisonModelName.split("/").pop()}
          </span>
        )}
        {selectedPrompt.judgeModelName && hasLLMCheck && (
          <span>
            <strong style={{ color: "#818cf8" }}>Judge:</strong>{" "}
            {selectedPrompt.judgeModelName.split("/").pop()}
          </span>
        )}
        {hasLLMCheck && llmPassRate !== null && (
          <span>
            <strong style={{ color: "#818cf8" }}>LLM Pass Rate:</strong>{" "}
            {llmPassRate}%
          </span>
        )}
      </div>

      {/* Primary metrics row */}
      <div className="metrics-row">
        <div className="metric-card">
          <span className="metric-label">Pass Rate</span>
          <span className="metric-value" style={{ color: passRate === 100 ? "#22c55e" : passRate >= 50 ? "#f59e0b" : "#ef4444" }}>
            {passRate}%
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Avg Latency</span>
          <span className="metric-value">{avgLatency} ms</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Runs</span>
          <span className="metric-value">{totalRuns}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Passed</span>
          <span className="metric-value">{passedRuns}</span>
        </div>
      </div>

      {/* Check performance row */}
      {(deterministicPassRate !== null || normalizedPassRate !== null || llmPassRate !== null) && (
        <div className="metrics-row" style={{ marginTop: "0.5rem" }}>
          {deterministicPassRate !== null && (
            <div className="metric-card">
              <span className="metric-label">Strict</span>
              <span className="metric-value">{deterministicPassRate}%</span>
            </div>
          )}
          {normalizedPassRate !== null && (
            <div className="metric-card">
              <span className="metric-label">Normalised</span>
              <span className="metric-value">{normalizedPassRate}%</span>
            </div>
          )}
          {llmPassRate !== null && (
            <div className="metric-card">
              <span className="metric-label">LLM Judge</span>
              <span className="metric-value">{llmPassRate}%</span>
            </div>
          )}
        </div>
      )}

      {/* Cost metrics row */}
      {hasCostData && (
        <div className="metrics-row" style={{ marginTop: "0.5rem" }}>
          <div className="metric-card">
            <span className="metric-label">Total Tokens</span>
            <span className="metric-value">{totalTokens.toLocaleString()}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Prompt Tokens</span>
            <span className="metric-value">{totalPromptTokens.toLocaleString()}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Completion Tokens</span>
            <span className="metric-value">{totalCompletionTokens.toLocaleString()}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Est. Total Cost</span>
            <span className="metric-value">${totalCostUsd.toFixed(5)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Cost / Run</span>
            <span className="metric-value">${avgCostPerRun.toFixed(5)}</span>
          </div>
        </div>
      )}

      {/* Statistical analysis */}
      <div style={{
        marginTop: "0.75rem", padding: "0.75rem",
        background: "#0f172a", borderRadius: "6px", border: "1px solid #1f2937",
      }}>
        <div style={{
          fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8",
          marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          Statistical Analysis
        </div>

        {/* Overall CI */}
        <div style={{ marginBottom: "0.4rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Pass rate:</span>
          <span style={{ fontSize: "0.75rem", color: "#e2e8f0", fontWeight: 600 }}>
            {Math.round(overallReliability.passRate * 100)}%
          </span>
          <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
            95% CI: {Math.round(overallReliability.ciLower * 100)}%–{Math.round(overallReliability.ciUpper * 100)}%
            {" "}(n={overallReliability.nRuns})
          </span>
          <span style={{
            fontSize: "0.72rem", padding: "0.1rem 0.4rem", borderRadius: "4px",
            background: overallReliability.reliable ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
            color: overallReliability.reliable ? "#22c55e" : "#f59e0b",
          }}>
            {overallReliability.interpretation}
          </span>
        </div>

        {/* Consistency */}
        <div style={{ marginBottom: "0.4rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Consistency:</span>
          <ConsistencyBadge score={overallConsistency.score} description={overallConsistency.description} />
          <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
            {overallConsistency.description} (variance={overallConsistency.variance})
          </span>
        </div>

        {/* McNemar */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>McNemar's test:</span>
          <span style={{ fontSize: "0.72rem", color: "#64748b", fontStyle: "italic" }}>
            {mcnemarNote}
          </span>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "Hide Details" : "Show Details"}
        </button>
      </div>

      {showDetails && perTestCaseRuns?.map(tcRun => {
        const test = testCases.find(t => t.id === tcRun.testCaseId);
        if (!test) return null;
        const isExpanded = expandedTestCases.includes(tcRun.testCaseId);
        const tcPassed = tcRun.runs.filter(r => computeIsPassed(r, test)).length;
        const tcTotal = tcRun.runs.length;
        const caseStats = perCaseStats.find(s => s.testCaseId === tcRun.testCaseId);

        return (
          <div key={tcRun.testCaseId} style={{ marginTop: "1.25rem", borderRadius: "8px", border: "1px solid #1f2937", overflow: "hidden" }}>
            <div
              onClick={() => toggleTestCase(tcRun.testCaseId)}
              style={{
                cursor: "pointer", padding: "0.75rem 1rem", background: "#1e293b",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{isExpanded ? "▼" : "►"}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {truncate(test.input, 60)}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{tcPassed}/{tcTotal} passed</span>
                  <span className={`badge ${tcPassed === tcTotal ? "success" : tcPassed === 0 ? "error" : "warning"}`}>
                    {tcPassed === tcTotal ? "PASS" : tcPassed === 0 ? "FAIL" : "PARTIAL"}
                  </span>
                </div>
                {caseStats && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "#64748b" }}>
                      CI: {Math.round(caseStats.reliability.ciLower * 100)}%–{Math.round(caseStats.reliability.ciUpper * 100)}%
                    </span>
                    <ConsistencyBadge
                      score={caseStats.consistency.score}
                      description={caseStats.consistency.description}
                    />
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "0.6rem 1rem", background: "#111827", borderBottom: "1px solid #1f2937", fontSize: "0.8rem", color: "#94a3b8", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              <span><strong style={{ color: "#cbd5e1" }}>Expected:</strong> {truncate(test.expectedOutput, 80)}</span>
              <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {test.strict && <span style={{ color: "#818cf8" }}>Strict</span>}
                {test.allowNormalized && <span style={{ color: "#818cf8" }}>Normalised</span>}
                {test.useLLMCheck && (
                  <span style={{ color: "#818cf8" }}>
                    LLM Judge
                    {selectedPrompt.judgeModelName && (
                      <span style={{ color: "#64748b" }}>
                        {" "}({selectedPrompt.judgeModelName.split("/").pop()})
                      </span>
                    )}
                  </span>
                )}
              </span>
            </div>

            {isExpanded && tcRun.runs.map(run => {
              const isPassed = computeIsPassed(run, test);
              return (
                <div
                  key={run.runNumber}
                  style={{
                    padding: "0.75rem 1rem", borderBottom: "1px solid #1f2937",
                    background: isPassed ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)",
                    borderLeft: `3px solid ${isPassed ? "#22c55e" : "#ef4444"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#94a3b8" }}>Run #{run.runNumber}</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{run.latency} ms</span>
                      {run.totalTokens != null && run.totalTokens > 0 && (
                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          {run.totalTokens.toLocaleString()} tok
                        </span>
                      )}
                      {run.estimatedCostUsd != null && run.estimatedCostUsd > 0 && (
                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          ${run.estimatedCostUsd.toFixed(5)}
                        </span>
                      )}
                      <span className={`badge ${isPassed ? "success" : "error"}`}>
                        {isPassed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>

                  <div style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Output</span>
                    <p style={{ fontSize: "0.85rem", color: "#e2e8f0", marginTop: "0.2rem", lineHeight: 1.5 }}>
                      {truncate(run.output, 200)}
                    </p>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.4rem" }}>
                    {test.strict && (
                      <span style={{
                        fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                        background: run.deterministicCheckPass === "TRUE" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
                        color: run.deterministicCheckPass === "TRUE" ? "#22c55e" : "#ef4444",
                        border: `1px solid ${run.deterministicCheckPass === "TRUE" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                      }}>
                        Strict: {run.deterministicCheckPass ?? "—"}
                      </span>
                    )}
                    {test.allowNormalized && (
                      <span style={{
                        fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                        background: run.normalisedCheckPass === "TRUE" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
                        color: run.normalisedCheckPass === "TRUE" ? "#22c55e" : "#ef4444",
                        border: `1px solid ${run.normalisedCheckPass === "TRUE" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                      }}>
                        Normalised: {run.normalisedCheckPass ?? "—"}
                      </span>
                    )}
                    {test.useLLMCheck && (
                      <span style={{
                        fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                        background: run.llmCheckPass === "TRUE" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
                        color: run.llmCheckPass === "TRUE" ? "#22c55e" : "#ef4444",
                        border: `1px solid ${run.llmCheckPass === "TRUE" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                      }}>
                        LLM Judge: {run.llmCheckPass ?? "—"}
                      </span>
                    )}
                  </div>

                  {test.useLLMCheck && run.llmReason && run.llmReason !== "N/A" && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Judge Reasoning
                        {selectedPrompt.judgeModelName && (
                          <span style={{ textTransform: "none", marginLeft: "0.25rem" }}>
                            · {selectedPrompt.judgeModelName.split("/").pop()}
                          </span>
                        )}
                      </span>
                      <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "0.2rem", lineHeight: 1.5 }}>
                        {truncate(run.llmReason, 180)}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={{ marginTop: "1.25rem", display: "flex", gap: "1rem" }}>
        <button className="btn-download" onClick={handleDownloadPromptCSV}>
          Download Prompt Config
        </button>
        <button className="btn-download" onClick={handleDownloadResultsCSV}>
          Download Results CSV
        </button>
        <button onClick={handleDownloadReport}>
          Download Evaluation Report
        </button>
      </div>
    </div>
  );
}