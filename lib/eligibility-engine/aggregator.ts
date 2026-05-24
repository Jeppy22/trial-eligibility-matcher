import type { EligibilityVerdict, MatchResult, Verdict } from "../types";

export function aggregateVerdict(results: MatchResult[]): EligibilityVerdict {
  const gaps: string[] = [];
  let hasNeedsMoreData = false;
  let exclusionMet = false;
  let inclusionNotMet = false;

  for (const r of results) {
    if (r.status === "needs_more_data") {
      hasNeedsMoreData = true;
      gaps.push(`[${r.criterion.id}] ${r.criterion.text}`);
      continue;
    }
    if (r.criterion.type === "exclusion" && r.status === "met") {
      exclusionMet = true;
    } else if (r.criterion.type === "inclusion" && r.status === "not_met") {
      inclusionNotMet = true;
    }
  }

  let verdict: Verdict;
  if (hasNeedsMoreData) {
    verdict = "NEEDS_MORE_DATA";
  } else if (exclusionMet || inclusionNotMet) {
    verdict = "INELIGIBLE";
  } else {
    verdict = "ELIGIBLE";
  }

  return {
    verdict,
    criteria_results: results,
    gaps,
  };
}
