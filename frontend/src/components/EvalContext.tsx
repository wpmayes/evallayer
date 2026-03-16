import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";

export interface PromptConfig {
  id: number;
  name: string;
  modelName: string;
  provider?: string;
  comparisonModelName?: string;
  comparisonProvider?: string;
  judgeModelName?: string;
  judgeProvider?: string;
  systemPrompt: string;
  userTemplate: string;
  temperature: number;
  maxTokens: number;
  schema: string;
  runsPerCase: number;
  retryOnInvalid: boolean;
}

export interface TestCase {
  id: number;
  input: string;
  expectedOutput: string;
  expectedFlags?: string[];
  expectedUrgency?: string;
  strict?: boolean;
  allowNormalized?: boolean;
  useLLMCheck?: boolean;
}

export interface RunResult {
  testCaseId: number;
  output: string;
  latency: number;
  retried: boolean;
  runNumber: number;
  deterministicCheck?: string;
  deterministicCheckPass?: "TRUE" | "FALSE";
  normalisedCheck?: string;
  normalisedCheckPass?: "TRUE" | "FALSE";
  llmCheck?: "TRUE" | "FALSE";
  llmCheckPass?: "TRUE" | "FALSE";
  llmReason?: string;
  reason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface TestCaseRun {
  testCaseId: number;
  runs: RunResult[];
}

export interface EvaluationResults {
  passRate: number;
  latency: number;
  totalRuns: number;
  passedRuns: number;
  perTestCaseRuns?: TestCaseRun[];
}

export interface EvalContextType {
  promptConfigs: PromptConfig[];
  setPromptConfigs: Dispatch<SetStateAction<PromptConfig[]>>;
  selectedPrompt: PromptConfig | null;
  setSelectedPrompt: Dispatch<SetStateAction<PromptConfig | null>>;
  testCases: TestCase[];
  setTestCases: Dispatch<SetStateAction<TestCase[]>>;
  evaluationResults: EvaluationResults | null;
  setEvaluationResults: Dispatch<SetStateAction<EvaluationResults | null>>;
  activeTestCaseId: number | null;
  setActiveTestCaseId: Dispatch<SetStateAction<number | null>>;
}

const defaultValue: EvalContextType = {
  promptConfigs: [],
  setPromptConfigs: () => {},
  selectedPrompt: null,
  setSelectedPrompt: () => {},
  testCases: [],
  setTestCases: () => {},
  evaluationResults: null,
  setEvaluationResults: () => {},
  activeTestCaseId: null,
  setActiveTestCaseId: () => {},
};

const EvalContext = createContext<EvalContextType>(defaultValue);

interface EvalProviderProps {
  children: ReactNode;
}

export const EvalProvider = ({ children }: EvalProviderProps) => {
  const [promptConfigs, setPromptConfigs] = useState<PromptConfig[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptConfig | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [evaluationResults, setEvaluationResults] = useState<EvaluationResults | null>(null);
  const [activeTestCaseId, setActiveTestCaseId] = useState<number | null>(null);

  return (
    <EvalContext.Provider
      value={{
        promptConfigs,
        setPromptConfigs,
        selectedPrompt,
        setSelectedPrompt,
        testCases,
        setTestCases,
        evaluationResults,
        setEvaluationResults,
        activeTestCaseId,
        setActiveTestCaseId,
      }}
    >
      {children}
    </EvalContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useEval = () => useContext(EvalContext);