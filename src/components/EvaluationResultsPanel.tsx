import { useState } from "react";
import { useEval } from "./EvalContext";

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

// Core pass logic: pass if ANY enabled check passes
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

  perTestCaseRuns?.forEach(tcRun => {
    const test = testCases.find(t => t.id === tcRun.testCaseId);
    tcRun.runs.forEach(run => {
      const isPassed = computeIsPassed(run, test);
      totalRuns++;
      if (isPassed) passedRuns++;
      totalLatency += run.latency ?? 0;
    });
  });

  const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
  const avgLatency = totalRuns > 0 ? Math.round(totalLatency / totalRuns) : 0;
  let deterministicTotal = 0;
  let deterministicPassed = 0;

  let normalizedTotal = 0;
  let normalizedPassed = 0;

  let llmTotal = 0;
  let llmPassed = 0;

  const failures: FailureRecord[] = [];
  const coverage: CoverageRecord[] = [];

  perTestCaseRuns?.forEach(tcRun => {
    const test = testCases.find(t => t.id === tcRun.testCaseId);
    if (!test) return;

    let tcPassed = 0;
    let tcFailed = 0;

    tcRun.runs.forEach(run => {

      const passed = computeIsPassed(run, test);

      if (passed) tcPassed++;
      else tcFailed++;

      // deterministic stats
      if (test.strict) {
        deterministicTotal++;
        if (run.deterministicCheckPass === "TRUE") deterministicPassed++;
      }

      // normalized stats
      if (test.allowNormalized) {
        normalizedTotal++;
        if (run.normalisedCheckPass === "TRUE") normalizedPassed++;
      }

      // llm stats
      if (test.useLLMCheck) {
        llmTotal++;
        if (run.llmCheckPass === "TRUE") llmPassed++;
      }

      // failure tracking
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

    coverage.push({
      testCaseId: test.id,
      runs: tcRun.runs.length,
      passed: tcPassed,
      failed: tcFailed
    });

  });
  const deterministicPassRate =
  deterministicTotal > 0
    ? Math.round((deterministicPassed / deterministicTotal) * 100)
    : null;

  const normalizedPassRate =
    normalizedTotal > 0
      ? Math.round((normalizedPassed / normalizedTotal) * 100)
      : null;

  const llmPassRate =
    llmTotal > 0
      ? Math.round((llmPassed / llmTotal) * 100)
      : null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const handleDownloadPromptCSV = () => {
    const headers = ["Prompt ID","Prompt Name","Model","System Prompt","User Template","Temperature","Max Tokens","Retry On Invalid","Runs Per Case"];
    const row = [
      selectedPrompt.id.toString(), selectedPrompt.name, selectedPrompt.modelName,
      formatText(selectedPrompt.systemPrompt), formatText(selectedPrompt.userTemplate),
      selectedPrompt.temperature.toString(), selectedPrompt.maxTokens.toString(),
      selectedPrompt.retryOnInvalid ? "TRUE" : "FALSE", selectedPrompt.runsPerCase.toString(),
    ];
    const csvContent = [headers.join(","), row.map(v => `"${v}"`).join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `prompt_config_${timestamp}.csv`;
    link.click();
  };

  const handleDownloadResultsCSV = () => {
    const headers = ["Prompt ID","Prompt Name","Model","Test Case ID","Test Case Input","Expected Output","Run #","LLM Output","Passed","Retry","Strict","Allow Normalized","LLM Check","LLM Reason","Reason"];
    const rows: string[][] = [];
    perTestCaseRuns?.forEach(tcRun => {
      const test = testCases.find(t => t.id === tcRun.testCaseId);
      if (!test) return;
      tcRun.runs.forEach(run => {
        const isPassed = computeIsPassed(run, test);
        rows.push([
          selectedPrompt.id.toString(), selectedPrompt.name, selectedPrompt.modelName,
          test.id.toString(), formatText(test.input), formatText(test.expectedOutput ?? ""),
          run.runNumber.toString(), formatText(run.output),
          isPassed ? "TRUE" : "FALSE", run.retried ? "TRUE" : "FALSE",
          test.strict ? "TRUE" : "FALSE", test.allowNormalized ? "TRUE" : "FALSE",
          run.llmCheck ?? "N/A", formatText(run.llmReason), formatText(run.reason),
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
        temperature: selectedPrompt.temperature,
        maxTokens: selectedPrompt.maxTokens
      },

      prompt: selectedPrompt,

      summary: {
        passRate,
        avgLatency,
        totalRuns,
        passedRuns
      },

      checkPerformance: {
        deterministicPassRate,
        normalizedPassRate,
        llmPassRate
      },

      coverage,

      failures,

      testCases: perTestCaseRuns
    };

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: "application/json" }
    );

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

      {/* Metrics row */}
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

      <div style={{ marginTop: "1rem" }}>
        <button onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "Hide Details" : "Show Details"}
        </button>
      </div>

      {showDetails && perTestCaseRuns?.map(tcRun => {
        const test = testCases.find(t => t.id === tcRun.testCaseId);
        if (!test) return null;
        const isExpanded = expandedTestCases.includes(tcRun.testCaseId);

        // Summary pass rate for this test case
        const tcPassed = tcRun.runs.filter(r => computeIsPassed(r, test)).length;
        const tcTotal = tcRun.runs.length;

        return (
          <div key={tcRun.testCaseId} style={{ marginTop: "1.25rem", borderRadius: "8px", border: "1px solid #1f2937", overflow: "hidden" }}>
            {/* Test case header */}
            <div
              onClick={() => toggleTestCase(tcRun.testCaseId)}
              style={{
                cursor: "pointer",
                padding: "0.75rem 1rem",
                background: "#1e293b",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{isExpanded ? "▼" : "►"}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {truncate(test.input, 60)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  {tcPassed}/{tcTotal} passed
                </span>
                <span className={`badge ${tcPassed === tcTotal ? "success" : tcPassed === 0 ? "error" : "warning"}`}>
                  {tcPassed === tcTotal ? "PASS" : tcPassed === 0 ? "FAIL" : "PARTIAL"}
                </span>
              </div>
            </div>

            {/* Expected + options row */}
            <div style={{ padding: "0.6rem 1rem", background: "#111827", borderBottom: "1px solid #1f2937", fontSize: "0.8rem", color: "#94a3b8", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              <span><strong style={{ color: "#cbd5e1" }}>Expected:</strong> {truncate(test.expectedOutput, 80)}</span>
              <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {test.strict && <span style={{ color: "#818cf8" }}>Strict</span>}
                {test.allowNormalized && <span style={{ color: "#818cf8" }}>Normalised</span>}
                {test.useLLMCheck && <span style={{ color: "#818cf8" }}>LLM Check</span>}
              </span>
            </div>

            {/* Run cards */}
            {isExpanded && tcRun.runs.map(run => {
              const isPassed = computeIsPassed(run, test);

              return (
                <div
                  key={run.runNumber}
                  style={{
                    padding: "0.75rem 1rem",
                    borderBottom: "1px solid #1f2937",
                    background: isPassed ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.04)",
                    borderLeft: `3px solid ${isPassed ? "#22c55e" : "#ef4444"}`,
                  }}
                >
                  {/* Run header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#94a3b8" }}>Run #{run.runNumber}</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{run.latency} ms</span>
                      <span className={`badge ${isPassed ? "success" : "error"}`}>
                        {isPassed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>

                  {/* Output */}
                  <div style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Output</span>
                    <p style={{ fontSize: "0.85rem", color: "#e2e8f0", marginTop: "0.2rem", lineHeight: 1.5 }}>
                      {truncate(run.output, 200)}
                    </p>
                  </div>

                  {/* Check results */}
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
                        LLM: {run.llmCheckPass ?? "—"}
                      </span>
                    )}
                  </div>

                  {/* LLM reason — only if LLM check was run */}
                  {test.useLLMCheck && run.llmReason && run.llmReason !== "N/A" && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>LLM Reason</span>
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