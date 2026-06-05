import type { PromptConfig, TestCase } from "../components/EvalContext";

/**
 * A ready-to-run sample suite so first-time visitors can see EvalLayer work
 * without configuring anything. Mirrors backend/examples/geography.yaml, and
 * uses runsPerCase: 3 so the consistency score and confidence intervals are
 * meaningful in the results. Runs against the live demo backend's own key —
 * the visitor doesn't need one.
 */
export function buildSampleSuite(): { prompt: PromptConfig; testCases: TestCase[] } {
  const base = Date.now();

  const prompt: PromptConfig = {
    id: base,
    name: "Sample — Geography basics",
    modelName: "HuggingFaceH4/zephyr-7b-beta",
    provider: "huggingface",
    comparisonModelName: "",
    comparisonProvider: "huggingface",
    judgeModelName: "meta-llama/Meta-Llama-3-70B-Instruct",
    judgeProvider: "huggingface",
    systemPrompt: "Answer with just the answer, no preamble or explanation.",
    userTemplate: "{input}",
    temperature: 0,
    maxTokens: 64,
    schema: '{"answer": "string"}',
    runsPerCase: 3,
    retryOnInvalid: true,
  };

  const testCases: TestCase[] = [
    {
      id: base + 1,
      input: "What is the capital of France?",
      expectedOutput: "Paris",
      strict: false,
      allowNormalized: true,
      useLLMCheck: false,
    },
    {
      id: base + 2,
      input: "What is the capital of Japan?",
      expectedOutput: "Tokyo",
      strict: false,
      allowNormalized: true,
      useLLMCheck: false,
    },
    {
      id: base + 3,
      input: "Which is the largest planet in our solar system?",
      expectedOutput: "Jupiter",
      strict: false,
      allowNormalized: true,
      useLLMCheck: true,
    },
  ];

  return { prompt, testCases };
}
