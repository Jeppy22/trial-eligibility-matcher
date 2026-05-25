import type {
  Criterion,
  EligibilityVerdict,
  FHIRBundle,
  MultiTrialResult,
  RetrievalResult,
  TrialEvaluation,
} from "../types";

type ParseFn = (text: string) => Promise<Criterion[]>;
type EvalFn = (
  bundle: FHIRBundle,
  criteria: Criterion[],
) => Promise<EligibilityVerdict>;

// Lazy so the LLM client is not constructed when the caller injects fakes
// (and so tests don't need to mock the Anthropic client module).
async function loadDefaultImpls(): Promise<{ parse: ParseFn; evalFn: EvalFn }> {
  const [{ parseCriteria }, { evaluateEligibility }] = await Promise.all([
    import("../criteria-parser"),
    import("../eligibility-engine"),
  ]);
  return { parse: parseCriteria, evalFn: evaluateEligibility };
}

export interface EvaluateOptions {
  concurrency?: number;
  maxTrials?: number;
  onProgress?: (done: number, total: number, currentNctId: string) => void;
  onTrialComplete?: (evaluation: TrialEvaluation) => void;
  // Injectable for testing. Default to the real LLM-backed implementations.
  parseCriteria?: ParseFn;
  evaluateEligibility?: EvalFn;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_TRIALS = 10;

function bucketEvaluations(evaluations: TrialEvaluation[]) {
  let eligible = 0;
  let ineligible = 0;
  let needsMoreData = 0;
  let errors = 0;
  for (const e of evaluations) {
    if (e.error || !e.verdict) {
      errors++;
      continue;
    }
    switch (e.verdict.verdict) {
      case "ELIGIBLE":
        eligible++;
        break;
      case "INELIGIBLE":
        ineligible++;
        break;
      case "NEEDS_MORE_DATA":
        needsMoreData++;
        break;
    }
  }
  return { eligible, ineligible, needsMoreData, errors };
}

export async function evaluatePatientAgainstTrials(
  bundle: FHIRBundle,
  candidates: RetrievalResult[],
  opts: EvaluateOptions = {},
): Promise<MultiTrialResult> {
  const t0 = Date.now();
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const maxTrials = Math.max(0, opts.maxTrials ?? DEFAULT_MAX_TRIALS);

  let parseCriteria: ParseFn;
  let evaluateEligibility: EvalFn;
  if (opts.parseCriteria && opts.evaluateEligibility) {
    parseCriteria = opts.parseCriteria;
    evaluateEligibility = opts.evaluateEligibility;
  } else {
    const defaults = await loadDefaultImpls();
    parseCriteria = opts.parseCriteria ?? defaults.parse;
    evaluateEligibility = opts.evaluateEligibility ?? defaults.evalFn;
  }

  const hardExcluded = candidates.filter((c) => c.hardExcluded);
  const eligible = candidates.filter((c) => !c.hardExcluded);
  const selected = eligible.slice(0, maxTrials);

  const evaluations: TrialEvaluation[] = new Array(selected.length);
  let done = 0;
  let next = 0;

  async function runOne(slotIndex: number): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= selected.length) return;
      const candidate = selected[i];
      const trial = candidate.trial;
      let evaluation: TrialEvaluation;
      try {
        const criteria = await parseCriteria(trial.criteriaText);
        if (criteria.length === 0) {
          evaluation = {
            trial,
            retrievalScore: candidate.score,
            retrievalReasons: candidate.reasons,
            verdict: null,
            error: "No criteria could be parsed from the trial text",
          };
        } else {
          const verdict = await evaluateEligibility(bundle, criteria);
          evaluation = {
            trial,
            retrievalScore: candidate.score,
            retrievalReasons: candidate.reasons,
            verdict,
          };
        }
      } catch (err) {
        evaluation = {
          trial,
          retrievalScore: candidate.score,
          retrievalReasons: candidate.reasons,
          verdict: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      evaluations[i] = evaluation;
      done++;
      try {
        opts.onTrialComplete?.(evaluation);
      } catch {
        // Callback errors must not break the pool.
      }
      try {
        opts.onProgress?.(done, selected.length, trial.nctId);
      } catch {
        // Same.
      }
      void slotIndex;
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, selected.length);
  for (let i = 0; i < workerCount; i++) workers.push(runOne(i));
  await Promise.all(workers);

  const counts = bucketEvaluations(evaluations);

  return {
    evaluations,
    hardExcluded,
    summary: {
      totalConsidered: candidates.length,
      evaluated: evaluations.length,
      eligible: counts.eligible,
      ineligible: counts.ineligible,
      needsMoreData: counts.needsMoreData,
      errors: counts.errors,
      hardExcluded: hardExcluded.length,
    },
    totalDurationMs: Date.now() - t0,
  };
}
