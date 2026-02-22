export interface LLMCheckResult {
  llmCheck: "TRUE" | "FALSE";
  reason: string;
}

export interface EvalOptions {
  strict?: boolean;
  allowNormalized?: boolean;
  allowedVariants?: string[];
  regexVariants?: RegExp[];
  useLLMCheck?: boolean;
  llmCheckFn?: (output: string, expected: string) => Promise<LLMCheckResult>;
  modelName?: string;
}

export async function evaluateOutput(
  output: string,
  expected?: string,
  options: EvalOptions = {}
): Promise<{
  deterministicCheck?: "TRUE" | "FALSE";
  deterministicCheckPass?: "TRUE" | "FALSE";
  normalisedCheck?: "TRUE" | "FALSE";
  normalisedCheckPass?: "TRUE" | "FALSE";
  llmCheck?: "TRUE" | "FALSE";
  llmCheckPass?: "TRUE" | "FALSE";
  llmReason?: string;
  overallPassed: boolean;
  reason: string;
}> {
  const {
    strict = false,
    allowNormalized = false,
    allowedVariants = [],
    regexVariants = [],
    useLLMCheck = false,
    llmCheckFn,
  } = options;

  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

  const actual = output.trim();
  const expectedTrimmed = expected?.trim();

  if (!expectedTrimmed) {
    return {
      deterministicCheck: undefined,
      deterministicCheckPass: "TRUE",
      normalisedCheck: undefined,
      normalisedCheckPass: "TRUE",
      overallPassed: true,
      reason: "No expected output",
    };
  }

  const deterministicCheck: "TRUE" | "FALSE" = "TRUE";
  let deterministicCheckPass: "TRUE" | "FALSE" = "FALSE";

  if (strict && actual === expectedTrimmed) {
    deterministicCheckPass = "TRUE";
  }

  const normalisedCheck: "TRUE" | "FALSE" = allowNormalized ? "TRUE" : "FALSE";
  let normalisedCheckPass: "TRUE" | "FALSE" = "FALSE";

  if (allowNormalized && normalize(actual) === normalize(expectedTrimmed)) {
    normalisedCheckPass = "TRUE";
  }

  if (allowedVariants.some(v => normalize(actual) === normalize(v))) {
    normalisedCheckPass = "TRUE";
  }

  if (regexVariants.some(rx => rx.test(actual))) {
    normalisedCheckPass = "TRUE";
  }

  let llmCheck: "TRUE" | "FALSE" | undefined;
  let llmCheckPass: "TRUE" | "FALSE" | undefined;
  let llmReason: string | undefined;

  if (useLLMCheck && llmCheckFn) {
    try {
      const result = await llmCheckFn(output, expectedTrimmed);
      llmCheck = result.llmCheck;
      llmCheckPass = result.llmCheck === "TRUE" ? "TRUE" : "FALSE";
      llmReason = result.reason;
    } catch (err) {
      llmCheck = "FALSE";
      llmCheckPass = "FALSE";
      llmReason = `LLM check failed: ${(err as Error).message}`;
    }
  }

  const overallPassed =
    deterministicCheckPass === "TRUE" ||
    normalisedCheckPass === "TRUE" ||
    llmCheckPass === "TRUE";

  const reasonParts = [
    deterministicCheckPass ? `Deterministic: ${deterministicCheckPass}` : null,
    normalisedCheckPass ? `Normalized: ${normalisedCheckPass}` : null,
    llmCheckPass
      ? `LLM: ${llmCheckPass}${llmReason ? ` (${llmReason})` : ""}`
      : null,
  ].filter(Boolean);

  return {
    deterministicCheck,
    deterministicCheckPass,
    normalisedCheck,
    normalisedCheckPass,
    llmCheck,
    llmCheckPass,
    llmReason,
    overallPassed,
    reason: reasonParts.join("; ") || "Failed all checks",
  };
}