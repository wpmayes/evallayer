"""
Statistical analysis for evaluation runs.
Server-side computation using scipy for rigorous, defensible results.

Three core analyses:
  wilson_ci         — confidence interval on a pass rate
  consistency_score — behavioural stability across repeated runs  
  mcnemar_test      — statistical comparison between two models
"""
from scipy import stats as scipy_stats
import numpy as np


def wilson_ci(passes: int, total: int, confidence: float = 0.95) -> dict:
    """
    Wilson score confidence interval for a pass rate.
    Preferred over normal approximation for small samples.
    """
    if total == 0:
        return {
            "pass_rate": 0.0, "ci_lower": 0.0, "ci_upper": 0.0,
            "ci_width": 0.0, "n": 0, "reliable": False,
            "interpretation": "No data"
        }

    z = scipy_stats.norm.ppf(1 - (1 - confidence) / 2)
    p = passes / total
    denom = 1 + z**2 / total
    centre = p + z**2 / (2 * total)
    margin = z * np.sqrt(p * (1 - p) / total + z**2 / (4 * total**2))
    lower = float(max(0, (centre - margin) / denom))
    upper = float(min(1, (centre + margin) / denom))
    width = upper - lower

    if total < 5:
        interpretation = "Insufficient runs — increase runs per case"
    elif width > 0.4:
        interpretation = "Very wide CI — results unreliable"
    elif width > 0.2:
        interpretation = "Moderate uncertainty — consider more runs"
    else:
        interpretation = "Reliable estimate"

    return {
        "pass_rate": round(p, 4),
        "ci_lower": round(lower, 4),
        "ci_upper": round(upper, 4),
        "ci_width": round(width, 4),
        "n": total,
        "reliable": width < 0.2 and total >= 5,
        "interpretation": interpretation,
    }


def consistency_score(passes: int, total: int) -> dict:
    """
    Bernoulli variance as a consistency signal.
    Peaks at 0.25 (p=0.5), drops to 0 at extremes.
    LOW consistency = model behaviour unstable on this case.
    """
    if total < 2:
        return {
            "score": "INSUFFICIENT", "variance": 0.0,
            "description": "Need at least 2 runs for consistency measure"
        }
    p = passes / total
    variance = float(p * (1 - p))

    if variance < 0.08:
        return {"score": "HIGH", "variance": round(variance, 4),
                "description": "Consistent behaviour across runs"}
    elif variance < 0.16:
        return {"score": "MEDIUM", "variance": round(variance, 4),
                "description": "Some variability — review individual runs"}
    else:
        return {"score": "LOW", "variance": round(variance, 4),
                "description": "Unstable — model behaviour inconsistent on this case"}


def mcnemar_test(results_a: list[bool], results_b: list[bool]) -> dict:
    """
    McNemar's test for paired comparison of two models on the same test cases.
    
    Assumes one observation per test case per model (or majority-vote 
    aggregation across runs). For repeated measures designs, consider
    Stuart-Maxwell or mixed effects logistic regression.
    
    Requires at least 10 discordant pairs for reliable results.
    """
    if len(results_a) != len(results_b):
        raise ValueError("Result lists must be same length")

    b = sum(1 for a, bv in zip(results_a, results_b) if a and not bv)
    c = sum(1 for a, bv in zip(results_a, results_b) if not a and bv)
    discordant = b + c

    if discordant < 10:
        return {
            "test": "mcnemar",
            "b": b, "c": c,
            "discordant_pairs": discordant,
            "p_value": None,
            "significant": None,
            "interpretation": (
                f"Insufficient discordant pairs ({discordant}) — "
                f"need at least 10 for reliable test. "
                f"Increase runs per case or test case count."
            ),
        }

    if discordant < 25:
        p_value = float(2 * scipy_stats.binom.cdf(min(b, c), discordant, 0.5))
        method = "exact binomial"
    else:
        chi2 = (abs(b - c) - 1) ** 2 / (b + c)
        p_value = float(scipy_stats.chi2.sf(chi2, df=1))
        method = "chi-squared with continuity correction"

    return {
        "test": "mcnemar",
        "method": method,
        "b": b,
        "c": c,
        "discordant_pairs": discordant,
        "p_value": round(p_value, 4),
        "significant": p_value < 0.05,
        "interpretation": (
            f"Significant difference detected (p={p_value:.4f}) — "
            f"models perform differently on these test cases"
            if p_value < 0.05
            else f"No significant difference detected (p={p_value:.4f})"
        ),
    }


def run_statistics(passes: int, total: int) -> dict:
    """Composite stats for a single run — used in run reports."""
    return {
        "reliability": wilson_ci(passes, total),
        "consistency": consistency_score(passes, total),
    }