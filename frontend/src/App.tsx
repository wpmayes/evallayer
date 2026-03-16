import { useState } from "react";
import { useEval } from "./components/EvalContext";
import type { RunResult } from "./components/EvalContext";
import { runEvaluation } from "./utils/runEvaluation";

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

  const handleRunEvaluation = async () => {
    if (!selectedPrompt || testCases.length === 0) return;

    setIsRunning(true);

    setProgress({
      testCaseIndex: 0,
      runNumber: 0,
      completedRuns: 0,
      totalRuns: testCases.length * selectedPrompt.runsPerCase,
    });

    const allResults: RunResult[] = await runEvaluation({
      promptConfig: selectedPrompt,
      testCases,
      onProgress: (info) => {
        setProgress(info);
      },
    });

    const computeOverallPassed = (r: RunResult) => {
      const tc = testCases.find(t => t.id === r.testCaseId);
      const checks: boolean[] = [];
      if (tc?.strict) checks.push(r.deterministicCheckPass === "TRUE");
      if (tc?.allowNormalized) checks.push(r.normalisedCheckPass === "TRUE");
      if (tc?.useLLMCheck) checks.push(r.llmCheckPass === "TRUE");
      return checks.length > 0 && checks.some(Boolean);
    };

    const totalRuns = allResults.length;
    const passedRuns = allResults.filter(computeOverallPassed).length;
    const passRate = totalRuns ? Math.round((passedRuns / totalRuns) * 100) : 0;
    const latency = totalRuns
      ? Math.round(allResults.reduce((sum, r) => sum + r.latency, 0) / totalRuns)
      : 0;

    const perTestCaseRuns = testCases.map((tc) => ({
      testCaseId: tc.id,
      runs: allResults.filter((r) => r.testCaseId === tc.id),
    }));

    setEvaluationResults({ totalRuns, passedRuns, passRate, latency, perTestCaseRuns });
    setIsRunning(false);
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
              criteria by combining options for deterministic checks, normalised matching, and
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
              to get pass rates, confidence intervals, latency, cost, and judge reasoning.
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