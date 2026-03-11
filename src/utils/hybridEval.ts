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

  const deterministicCheck: "TRUE" | "FALSE" | undefined = strict ? "TRUE" : undefined;
  let deterministicCheckPass: "TRUE" | "FALSE" | undefined = undefined;

  if (strict && actual === expectedTrimmed) {
    deterministicCheckPass = "TRUE";
  } else if (strict) {
    deterministicCheckPass = "FALSE";
  }

  const normalisedCheck: "TRUE" | "FALSE" | undefined = allowNormalized ? "TRUE" : undefined;
  let normalisedCheckPass: "TRUE" | "FALSE" | undefined = undefined;

  if (allowNormalized) {
    normalisedCheckPass = (
      normalize(actual).includes(normalize(expectedTrimmed)) ||
      allowedVariants.some(v => normalize(actual).includes(normalize(v))) ||
      regexVariants.some(rx => rx.test(actual))
    ) ? "TRUE" : "FALSE";
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

  const overallPassed = (
    (!strict || deterministicCheckPass === "TRUE") &&
    (!allowNormalized || normalisedCheckPass === "TRUE") &&
    (!useLLMCheck || llmCheckPass === "TRUE")
  );

  const reasonParts = [
    deterministicCheckPass ? `Deterministic: ${deterministicCheckPass}` : null,
    normalisedCheckPass ? `Normalised: ${normalisedCheckPass}` : null,
    llmCheckPass ? `LLM: ${llmCheckPass}${llmReason ? ` (${llmReason})` : ""}` : null,
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