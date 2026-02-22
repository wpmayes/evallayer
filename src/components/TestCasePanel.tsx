import { useState } from "react";
import { useEval } from "./EvalContext";
import type { TestCase } from "./EvalContext";

export default function TestCasePanel() {
  const { selectedPrompt, testCases, setTestCases, activeTestCaseId, setActiveTestCaseId } = useEval();
  const [newInput, setNewInput] = useState("");
  const [newExpected, setNewExpected] = useState("");
  const [newStrict, setNewStrict] = useState(false);
  const [newAllowNormalized, setNewAllowNormalized] = useState(true);
  const [newUseLLMCheck, setNewUseLLMCheck] = useState(true);

  const addTestCase = () => {
    if (!newInput.trim()) return;

    const newCase: TestCase = {
      id: Date.now(),
      input: newInput,
      expectedOutput: newExpected,
      strict: newStrict,
      allowNormalized: newAllowNormalized,
      useLLMCheck: newUseLLMCheck,
    };

    setTestCases([...testCases, newCase]);
    setNewInput("");
    setNewExpected("");
    setNewStrict(false);
    setNewAllowNormalized(true);
    setNewUseLLMCheck(true);
  };

  const updateTestCase = (id: number, updates: Partial<TestCase>) => {
    setTestCases(
      testCases.map((tc) => (tc.id === id ? { ...tc, ...updates } : tc))
    );
  };

  const deleteTestCase = (id: number) => {
    if (activeTestCaseId === id) setActiveTestCaseId(null);
    setTestCases(testCases.filter((tc) => tc.id !== id));
  };

  if (!selectedPrompt) {
    return (
      <div className="form-panel">
        <h2>Test Cases</h2>
        <p>Select a prompt first.</p>
      </div>
    );
  }

  return (
    <div className="form-panel">
      <h2>Test Cases</h2>

      <div className="form-section">
        <textarea
          placeholder="Test input..."
          value={newInput}
          onChange={(e) => setNewInput(e.target.value)}
          rows={3}
        />

        <textarea
          placeholder="Expected output (optional)"
          value={newExpected}
          onChange={(e) => setNewExpected(e.target.value)}
          rows={2}
        />

        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          <label title="Exact match to expected output. Useful for precise answers.">
            <input
              type="checkbox"
              checked={newStrict}
              onChange={(e) => setNewStrict(e.target.checked)}
            /> Strict
          </label>

          <label title="Ignores minor differences like whitespace, capitalization, or punctuation.">
            <input
              type="checkbox"
              checked={newAllowNormalized}
              onChange={(e) => setNewAllowNormalized(e.target.checked)}
            /> Allow normalized
          </label>

          <label title="Uses an LLM to check if the output is semantically correct, even if it does not exactly match.">
            <input
              type="checkbox"
              checked={newUseLLMCheck}
              onChange={(e) => setNewUseLLMCheck(e.target.checked)}
            /> LLM semantic check
          </label>
        </div>

        <button onClick={addTestCase} style={{ marginTop: "0.5rem" }}>
          Add Test Case
        </button>
      </div>

      <div className="form-section">
        {testCases.length === 0 && <p style={{ color: "#64748b" }}>No test cases yet.</p>}

        {testCases.map((tc) => (
          <div
            key={tc.id}
            className={`card ${tc.id === activeTestCaseId ? "selected" : ""}`}
            onClick={() => setActiveTestCaseId(tc.id)}
          >
            <div>
              <strong>Input:</strong>
              <p>{tc.input}</p>
            </div>

            {tc.expectedOutput && (
              <div>
                <strong>Expected:</strong>
                <p>{tc.expectedOutput}</p>
              </div>
            )}

            <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <label title="Exact match to expected output. Useful for precise answers.">
                <input
                  type="checkbox"
                  checked={tc.strict ?? false}
                  onChange={(e) => updateTestCase(tc.id, { strict: e.target.checked })}
                /> Strict
              </label>

              <label title="Ignores minor differences like whitespace, capitalization, or punctuation.">
                <input
                  type="checkbox"
                  checked={tc.allowNormalized ?? true}
                  onChange={(e) => updateTestCase(tc.id, { allowNormalized: e.target.checked })}
                /> Allow normalized
              </label>

              <label title="Uses an LLM to check if the output is semantically correct, even if it does not exactly match.">
                <input
                  type="checkbox"
                  checked={tc.useLLMCheck ?? true}
                  onChange={(e) => updateTestCase(tc.id, { useLLMCheck: e.target.checked })}
                /> LLM semantic check
              </label>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); deleteTestCase(tc.id); }}
              style={{ marginTop: "0.5rem" }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}