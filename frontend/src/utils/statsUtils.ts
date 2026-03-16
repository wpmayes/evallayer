// src/utils/statsUtils.ts

export interface ReliabilityStats {
  passRate: number;
  ciLower: number;
  ciUpper: number;
  ciWidth: number;
  nRuns: number;
  reliable: boolean;
  interpretation: string;
}

export interface ConsistencyStats {
  score: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  variance: number;
  description: string;
}

export interface McNemarResult {
  b: number;
  c: number;
  discordantPairs: number;
  pValue: number | null;
  significant: boolean | null;
  interpretation: string;
  method?: string;
}

export interface PerCaseStats {
  testCaseId: number;
  reliability: ReliabilityStats;
  consistency: ConsistencyStats;
}

export interface ComparisonStats {
  ciA: ReliabilityStats;
  ciB: ReliabilityStats;
  mcnemar: McNemarResult;
}

export function wilsonCI(passes: number, total: number, confidence = 0.95): ReliabilityStats {
  if (total === 0) {
    return {
      passRate: 0, ciLower: 0, ciUpper: 0, ciWidth: 0,
      nRuns: 0, reliable: false, interpretation: "No data",
    };
  }

  const z = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;
  const p = passes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt(p * (1 - p) / total + (z * z) / (4 * total * total));
  const lower = Math.max(0, (centre - margin) / denom);
  const upper = Math.min(1, (centre + margin) / denom);
  const width = upper - lower;

  let interpretation: string;
  if (total < 5) {
    interpretation = "Insufficient runs — increase runs per case for reliable estimate";
  } else if (width > 0.4) {
    interpretation = "Very wide CI — results unreliable";
  } else if (width > 0.2) {
    interpretation = "Moderate uncertainty — consider more runs";
  } else {
    interpretation = "Reliable estimate";
  }

  return {
    passRate: Math.round(p * 10000) / 10000,
    ciLower: Math.round(lower * 10000) / 10000,
    ciUpper: Math.round(upper * 10000) / 10000,
    ciWidth: Math.round(width * 10000) / 10000,
    nRuns: total,
    reliable: width < 0.2 && total >= 5,
    interpretation,
  };
}

export function consistencyScore(passes: number, total: number): ConsistencyStats {
  if (total < 2) {
    return { score: "INSUFFICIENT", variance: 0, description: "Need at least 2 runs" };
  }
  const p = passes / total;
  const variance = Math.round(p * (1 - p) * 10000) / 10000;
  if (variance < 0.08) {
    return { score: "HIGH", variance, description: "Consistent behaviour across runs" };
  } else if (variance < 0.16) {
    return { score: "MEDIUM", variance, description: "Some variability — review individual runs" };
  } else {
    return { score: "LOW", variance, description: "Unstable — model behaviour inconsistent on this case" };
  }
}


function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2315419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

function binomialCDF(k: number, n: number, p: number): number {
  let cdf = 0;
  for (let i = 0; i <= k; i++) {
    let coeff = 1;
    for (let j = 0; j < i; j++) {
      coeff = coeff * (n - j) / (j + 1);
    }
    cdf += coeff * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return cdf;
}

export function mcnemarTest(
  resultsA: boolean[],
  resultsB: boolean[]
): McNemarResult {
  if (resultsA.length !== resultsB.length) {
    return {
      b: 0, c: 0, discordantPairs: 0,
      pValue: null, significant: null,
      interpretation: "Result lists must be the same length",
    };
  }

  const b = resultsA.filter((a, i) => a && !resultsB[i]).length;
  const c = resultsA.filter((a, i) => !a && resultsB[i]).length;
  const discordant = b + c;

  if (discordant < 10) {
    return {
      b, c, discordantPairs: discordant,
      pValue: null, significant: null,
      interpretation: `Insufficient discordant pairs (${discordant}) — need at least 10 for reliable test. Increase test cases or runs per case.`,
    };
  }

  let pValue: number;
  let method: string;

  if (discordant < 25) {
    pValue = 2 * binomialCDF(Math.min(b, c), discordant, 0.5);
    method = "exact binomial";
  } else {
    const chi2 = Math.pow(Math.abs(b - c) - 1, 2) / (b + c);
    pValue = 1 - normalCDF(Math.sqrt(chi2)) * 2 + 1;
    pValue = 2 * (1 - normalCDF(Math.sqrt(chi2)));
    method = "chi-squared with continuity correction";
  }

  pValue = Math.round(pValue * 10000) / 10000;

  return {
    b, c, discordantPairs: discordant,
    pValue,
    significant: pValue < 0.05,
    method,
    interpretation: pValue < 0.05
      ? `Significant difference detected (p=${pValue}) — models perform differently on these test cases`
      : `No significant difference detected (p=${pValue})`,
  };
}