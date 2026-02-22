import { useState } from "react";
import { useEval } from "./EvalContext";

function formatText(text?: string) {
  if (!text) return "N/A";
  return text
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
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
    tcRun.runs.forEach(run => {
      const isPassed =
        run.deterministicCheckPass === "TRUE" ||
        run.normalisedCheckPass === "TRUE" ||
        run.llmCheckPass === "TRUE";
      totalRuns++;
      if (isPassed) passedRuns++;
      totalLatency += run.latency ?? 0;
    });
  });

  const passRate =
    totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
  const avgLatency =
    totalRuns > 0 ? Math.round(totalLatency / totalRuns) : 0;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const handleDownloadPromptCSV = () => {
    const headers = [
      "Prompt ID",
      "Prompt Name",
      "Model",
      "System Prompt",
      "User Template",
      "Temperature",
      "Max Tokens",
      "Retry On Invalid",
      "Runs Per Case",
    ];
    const row = [
      selectedPrompt.id.toString(),
      selectedPrompt.name,
      selectedPrompt.modelName,
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
      "Prompt ID",
      "Prompt Name",
      "Model",
      "Test Case ID",
      "Test Case Input",
      "Expected Output",
      "Run #",
      "LLM Output",
      "Passed",
      "Retry",
      "Strict",
      "Allow Normalized",
      "LLM Check",
      "LLM Reason",
      "Reason",
    ];

    const rows: string[][] = [];

    perTestCaseRuns?.forEach(tcRun => {
      const test = testCases.find(t => t.id === tcRun.testCaseId);
      if (!test) return;

      tcRun.runs.forEach(run => {
        const isPassed =
          run.deterministicCheckPass === "TRUE" ||
          run.normalisedCheckPass === "TRUE" ||
          run.llmCheckPass === "TRUE";

        rows.push([
          selectedPrompt.id.toString(),
          selectedPrompt.name,
          selectedPrompt.modelName,
          test.id.toString(),
          formatText(test.input),
          formatText(test.expectedOutput ?? ""),
          run.runNumber.toString(),
          formatText(run.output),
          isPassed ? "TRUE" : "FALSE",
          run.retried ? "TRUE" : "FALSE",
          test.strict ? "TRUE" : "FALSE",
          test.allowNormalized ? "TRUE" : "FALSE",
          run.llmCheck ?? "N/A",
          formatText(run.llmReason),
          formatText(run.reason),
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

  const toggleTestCase = (id: number) => {
    setExpandedTestCases(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="form-panel">
      <h2>Evaluation Results</h2>

      {/* Metrics */}
      <div className="metrics-row">
        <div className="metric-card">
          <span className="metric-label">Pass Rate</span>
          <span className="metric-value">{passRate}%</span>
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
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{ padding: "0.5rem 1rem", borderRadius: "6px", cursor: "pointer" }}
        >
          {showDetails ? "Hide All Detailed Results" : "Show All Detailed Results"}
        </button>
      </div>

      {showDetails &&
        perTestCaseRuns?.map(tcRun => {
          const test = testCases.find(t => t.id === tcRun.testCaseId);
          if (!test) return null;

          const isExpanded = expandedTestCases.includes(tcRun.testCaseId);

          return (
            <div key={tcRun.testCaseId} className="testcase-section">
              <h3
                style={{ cursor: "pointer" }}
                onClick={() => toggleTestCase(tcRun.testCaseId)}
              >
                {isExpanded ? "▼" : "►"} Test Case: {formatText(test.input)}
              </h3>
              <p><strong>Expected:</strong> {formatText(test.expectedOutput)}</p>
              <p>
                <strong>Options:</strong>{" "}
                Strict: {test.strict ? "TRUE" : "FALSE"},{" "}
                Allow Normalized: {test.allowNormalized ? "TRUE" : "FALSE"},{" "}
                LLM Check: {test.useLLMCheck ? "TRUE" : "FALSE"}
              </p>

              {isExpanded &&
                tcRun.runs.map(run => {
                  const isPassed =
                    run.deterministicCheckPass === "TRUE" ||
                    run.normalisedCheckPass === "TRUE" ||
                    run.llmCheckPass === "TRUE";

                  return (
                    <div
                      key={run.runNumber}
                      className={`run-card ${isPassed ? "passed" : "failed"}`}
                      style={{ marginBottom: "0.75rem", padding: "0.5rem", borderRadius: "6px", border: "1px solid #334155" }}
                    >
                      <p><strong>Run #{run.runNumber}</strong></p>
                      <p><strong>Output:</strong> {formatText(run.output)}</p>
                      <p><strong>Passed:</strong> {isPassed ? "TRUE" : "FALSE"}</p>

                      {test.useLLMCheck && run.llmCheck && (
                        <p>
                          <strong>LLM Check:</strong>{" "}
                          <span
                            className={`llm-badge ${
                              run.llmCheck === "TRUE" ? "approved" : "rejected"
                            }`}
                          >
                            {run.llmCheck}: {formatText(run.llmReason)}
                          </span>
                        </p>
                      )}

                      <p><strong>Reason:</strong> {formatText(run.reason)}</p>
                      <p><strong>Latency:</strong> {run.latency} ms</p>
                      <p><strong>Retried:</strong> {run.retried ? "TRUE" : "FALSE"}</p>
                    </div>
                  );
                })}
            </div>
          );
        })}

      <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
        <button className="btn-download" onClick={handleDownloadPromptCSV}>
          Download Prompt Config
        </button>
        <button className="btn-download" onClick={handleDownloadResultsCSV}>
          Download Per-Run Results
        </button>
      </div>
    </div>
  );
}