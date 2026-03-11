import { useState } from "react";
import { useEval } from "./components/EvalContext";
import type { RunResult } from "./components/EvalContext";
import { runEvaluation } from "./utils/runEvaluation";

import Header from "./components/Header";
import ThreePanelLayout from "./components/ThreePanelLayout";
import PromptConfigPanel from "./components/PromptConfigPanel";
import TestCasePanel from "./components/TestCasePanel";
import EvaluationResultsPanel from "./components/EvaluationResultsPanel";

export default function App() {
  const {
    selectedPrompt,
    testCases,
    setEvaluationResults,
  } = useEval();

  const [isRunning, setIsRunning] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
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
  runs: allResults.filter(
    (r) => r.testCaseId === tc.id
  ),
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
          <h2>Evaluate LLM Systems Like Production Software</h2>
          <button
            className="intro-toggle"
            onClick={() => setShowIntro(!showIntro)}
          >
            {showIntro ? "Hide" : "Why structured evaluation?"}
          </button>
        </div>

{showIntro && (
  <div className="intro-content">
    <p>
      <strong>EvalLayer</strong> is a structured evaluation framework designed to test large language models (LLMs) against well-defined, repeatable criteria. 
      Unlike informal prompt testing or ad-hoc experiments, EvalLayer emphasises measurable, reproducible results, making it ideal for prompt optimisation, model comparison, and regression tracking.
    </p>

    <h4>Core Concepts</h4>
    <ul>
      <li><strong>Prompt Configuration:</strong> A structured template for the LLM, including the system instructions, user-facing template, model choice, temperature, max tokens, and other parameters.</li>
      <li><strong>Test Case:</strong> A single scenario the LLM should handle. Each test case defines:
        <ul>
          <li><strong>Input:</strong> The structured content or question to feed to the LLM.</li>
          <li><strong>Expected Output:</strong> The exact string, JSON schema, or rule the model is expected to produce.</li>
          <li><strong>Validation Options:</strong> Flags like strict comparison, normalised comparison, and optional LLM-based semantic checks.</li>
        </ul>
      </li>
      <li><strong>Checks:</strong> Evaluate how closely the LLM output matches expectations:
        <ul>
          <li><strong>Deterministic Check:</strong> Exact match to the expected output. Best for cases where the answer should be precise and unambiguous.</li>
          <li><strong>Normalised Check:</strong> Ignores minor variations such as whitespace, capitalisation, or punctuation. Useful when formatting differences are irrelevant but you still wish to test for a specific response.</li>
          <li><strong>LLM Semantic Check:</strong> Uses a secondary LLM to determine whether the model’s output is semantically correct, even if it doesn’t exactly match the expected text. Ideal for open-ended answers or natural language explanations.</li>
        </ul>
      </li>
    </ul>

    <h4>Getting Started</h4>
    <ol>
      <li>
        <strong>Create or select a prompt configuration: </strong> 
        Define the system prompt, user template (with input placeholders), model parameters, and any retry or output formatting rules.
      </li>
      <li>
        <strong>Add structured test cases: </strong> 
        Enter the inputs and expected outputs, select the appropriate validation options (strict, normalised, LLM check), and decide how many runs per case you want to perform.
      </li>
      <li>
        <strong>Run evaluations: </strong> 
        Execute the prompt against all test cases. EvalLayer will automatically compute:
        <ul>
          <li>Pass/Fail status for each run</li>
          <li>Aggregate pass rate</li>
          <li>Average latency</li>
          <li>Detailed reasons for failures or partial success</li>
        </ul>
        This enables accurate measurement of model consistency, reliability, and improvement over time.
      </li>
    </ol>

    <p>
      By combining structured prompts, repeatable test cases, and multiple evaluation checks, EvalLayer helps you transform qualitative prompt experiments into rigorous, quantifiable assessments. 
      Whether you are fine-tuning prompts, comparing models, or monitoring regressions, this framework ensures your evaluations are transparent, consistent, and reproducible.
    </p>
  </div>
)}
  </div>

      <ThreePanelLayout
        left={<PromptConfigPanel />}
        center={<TestCasePanel />}
        right={<EvaluationResultsPanel />}
      />

      <footer className="app-footer">
        <div
          className={`connection-badge ${
            selectedPrompt ? "connected" : "disconnected"
          }`}
        >
          <span className="status-dot" />
          {selectedPrompt ? "Connected" : "Offline"}
          {selectedPrompt && (
            <span className="model-name"> · {selectedPrompt.modelName}</span>
          )}
        </div>

        <button
          className="run-button"
          onClick={handleRunEvaluation}
          disabled={isRunning || !selectedPrompt || testCases.length === 0}
        >
          {isRunning ? "Running..." : "Run Evaluation"}
        </button>
      </footer>
    </div>
  );
}