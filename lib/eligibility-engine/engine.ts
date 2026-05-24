import type {
  Criterion,
  EligibilityVerdict,
  FHIRBundle,
  MatchResult,
} from "../types";
import { aggregateVerdict } from "./aggregator";
import { gatherEvidence } from "./evidence";
import { evaluateCriterion } from "./evaluator";

export async function evaluateEligibility(
  bundle: FHIRBundle,
  criteria: Criterion[],
): Promise<EligibilityVerdict> {
  const results: MatchResult[] = [];
  for (const criterion of criteria) {
    const evidence = gatherEvidence(bundle, criterion.requiredData);
    const result = await evaluateCriterion(criterion, evidence);
    results.push(result);
  }
  return aggregateVerdict(results);
}
