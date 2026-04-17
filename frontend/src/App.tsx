import { useState } from "react";
import { useEval } from "./components/EvalContext";
import type { RunResult } from "./components/EvalContext";
import { runEvaluation } from "./utils/runEvaluation";
import { API_BASE_URL } from "./config";

import Header from "./components/Header";
import ThreePanelLayout from "./components/ThreePanelLayout";
import PromptConfigPanel from "./components/PromptConfigPanel";
import TestCasePanel from "./components/TestCasePanel";
import EvaluationResultsPanel from "./components/EvaluationResultsPanel";
import Footer from "./components/Footer";

export default function App() {
  const {
    selectedPrompt,
    testCases,
    setEvaluationResults,
  } = useEval();

  const [isRunning, setIsRunning] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [progress, setProgress] = useState({
    testCaseIndex: 0,
    runNumber: 0,
    completedRuns: 0,
    totalRuns: 0,
  });

  // ── Suite + case creation ───────────────────────────────────────────────────
  // Returns the suite ID and a map of backendCaseId → frontendTcId so that
  // results from the backend can be matched back to the right test case in
  // EvaluationResultsPanel.
  const createBackendSuite = async (): Promise<{
    suiteId: number;
    backendToFrontendId: Record<number, number>;
  }> => {
    if (!selectedPrompt) throw new Error("No prompt config selected");

    // 1. Create suite
    const suiteResp = await fetch(`${API_BASE_URL}/suites/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: selectedPrompt.name,
        description: `EvalLayer UI run — ${new Date().toISOString()}`,
        prompt_config: {
          system_prompt: selectedPrompt.systemPrompt,
          user_template: selectedPrompt.userTemplate,
        },
      }),
    });
    if (!suiteResp.ok) {
      throw new Error(`Failed to create suite: ${await suiteResp.text()}`);
    }
    const suite = await suiteResp.json();
    const suiteId: number = suite.id;

    // 2. Add each test case, record backend ID → frontend ID
    const backendToFrontendId: Record<number, number> = {};
    for (const tc of testCases) {
      const caseResp = await fetch(`${API_BASE_URL}/suites/${suiteId}/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suite_id: suiteId,
          name: `Case ${tc.id}`,
          input_data: { input: tc.input },
          expected_output: tc.expectedOutput,
          check_strict:      tc.strict         ?? false,
          check_normalised:  tc.allowNormalized ?? true,
          check_llm:         tc.useLLMCheck     ?? false,
        }),
      });
      if (!caseResp.ok) {
        throw new Error(`Failed to create test case: ${await caseResp.text()}`);
      }
      const backendCase = await caseResp.json();
      // backendCase.id is the DB auto-increment ID; tc.id is the frontend ID
      backendToFrontendId[backendCase.id] = tc.id;
    }

    return { suiteId, backendToFrontendId };
  };

  // ── Run evaluation ──────────────────────────────────────────────────────────
  const handleRunEvaluation = async () => {
    if (!selectedPrompt || testCases.length === 0) return;

    setIsRunning(true);
    const totalRuns = testCases.length * selectedPrompt.runsPerCase;
    setProgress({ testCaseIndex: 0, runNumber: 0, completedRuns: 0, totalRuns });

    try {
      const { suiteId, backendToFrontendId } = await createBackendSuite();

      const allResults: RunResult[] = await runEvaluation({
        suiteId,
        backendToFrontendId,
        promptConfig: selectedPrompt,
        testCases,
        onProgress: (info) => {
          // info.completed = passed + failed cases so far (from backend)
          // Map onto the progress shape Header expects
          setProgress({
            testCaseIndex: Math.max(0, info.completed - 1),
            runNumber: info.completed,
            completedRuns: info.completed,
            totalRuns: info.total > 0 ? info.total : totalRuns,
          });
        },
      });

      // ── Compute summary metrics ─────────────────────────────────────────────
      const computeOverallPassed = (r: RunResult) => {
        const tc = testCases.find(t => t.id === r.testCaseId);
        if (!tc) return false;
        const checks: boolean[] = [];
        if (tc.strict)          checks.push(r.deterministicCheckPass === "TRUE");
        if (tc.allowNormalized) checks.push(r.normalisedCheckPass === "TRUE");
        if (tc.useLLMCheck)     checks.push(r.llmCheckPass === "TRUE");
        // If no check types enabled, fall back to backend's overall passed field
        if (checks.length === 0) return false;
        return checks.some(Boolean);
      };

      const passedRuns  = allResults.filter(computeOverallPassed).length;
      const runCount    = allResults.length;
      const passRate    = runCount ? Math.round((passedRuns / runCount) * 100) : 0;
      const latency     = runCount
        ? Math.round(allResults.reduce((s, r) => s + r.latency, 0) / runCount)
        : 0;

      // Group by frontend test case ID (now correctly mapped)
      const perTestCaseRuns = testCases.map((tc) => ({
        testCaseId: tc.id,
        runs: allResults.filter((r) => r.testCaseId === tc.id),
      }));

      setEvaluationResults({
        totalRuns: runCount,
        passedRuns,
        passRate,
        latency,
        perTestCaseRuns,
      });

      // Mark progress as complete
      setProgress(p => ({ ...p, completedRuns: p.totalRuns }));

    } catch (err) {
      console.error("Evaluation failed:", err);
      alert(`Evaluation failed: ${(err as Error).message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="App">
      <Header
        isRunning={isRunning}
        progress={progress}
      />

      <div className="app-intro">
        <div className="intro-header">
          <h2>How it works</h2>
          <button
            className="intro-toggle"
            onClick={() => setShowIntro(!showIntro)}
          >
            {showIntro ? "Hide" : "Show"}
          </button>
        </div>

        {showIntro && (
          <div className="intro-content">
            <p>
              <strong>EvalLayer</strong> tests LLMs against well-defined, repeatable
              criteria by combining deterministic checks, normalised matching, and
              LLM-as-judge evaluation with statistical analysis and model comparison.
            </p>
            <p style={{ color: "#64748b", fontSize: "0.875rem", marginTop: "0.5rem" }}>
              <strong style={{ color: "#94a3b8" }}>1. Configure</strong>{" "}
              a prompt with system instructions, model, and parameters.
              {" · "}
              <strong style={{ color: "#94a3b8" }}>2. Add test cases</strong>{" "}
              with inputs, expected outputs, and validation rules.
              {" · "}
              <strong style={{ color: "#94a3b8" }}>3. Run</strong>{" "}
              to get pass rates, confidence intervals, latency, and judge reasoning.
            </p>
          </div>
        )}
      </div>

      <ThreePanelLayout
        left={<PromptConfigPanel />}
        center={<TestCasePanel />}
        right={<EvaluationResultsPanel />}
      />

      <Footer
        onRunEvaluation={handleRunEvaluation}
        isRunning={isRunning}
        disabled={isRunning || !selectedPrompt || testCases.length === 0}
      />
    </div>
  );
}