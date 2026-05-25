import { describe, expect, it, vi } from "vitest";

import type {
  Criterion,
  EligibilityVerdict,
  FHIRBundle,
  RetrievalResult,
  Trial,
  Verdict,
} from "../types";
import { evaluatePatientAgainstTrials } from "./index";

const emptyBundle: FHIRBundle = { resourceType: "Bundle", entry: [] };

function makeTrial(nctId: string, overrides: Partial<Trial> = {}): Trial {
  return {
    nctId,
    title: `Trial ${nctId}`,
    conditions: [],
    conditionCodes: [],
    phase: "PHASE2",
    sex: "ALL",
    minimumAge: null,
    maximumAge: null,
    healthyVolunteers: false,
    criteriaText: "Inclusion Criteria: Adult.",
    focusArea: "test",
    ...overrides,
  };
}

function makeCandidate(nctId: string, hardExcluded = false): RetrievalResult {
  return {
    trial: makeTrial(nctId),
    score: hardExcluded ? 0 : 10,
    reasons: hardExcluded ? [] : ["Patient has X"],
    hardExcluded,
    exclusionReason: hardExcluded ? "Trial requires FEMALE patients" : undefined,
  };
}

function makeVerdict(v: Verdict): EligibilityVerdict {
  return { verdict: v, criteria_results: [], gaps: [] };
}

const okCriteria: Criterion[] = [
  { id: "C1", text: "Adult.", type: "inclusion", requiredData: ["Patient"] },
];

describe("evaluatePatientAgainstTrials", () => {
  it("evaluates each non-excluded candidate up to maxTrials", async () => {
    const candidates = [
      makeCandidate("A"),
      makeCandidate("B"),
      makeCandidate("C"),
      makeCandidate("D"),
    ];
    const parseCriteria = vi.fn().mockResolvedValue(okCriteria);
    const evaluateEligibility = vi
      .fn()
      .mockResolvedValue(makeVerdict("ELIGIBLE"));

    const result = await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      maxTrials: 2,
      parseCriteria,
      evaluateEligibility,
    });

    expect(parseCriteria).toHaveBeenCalledTimes(2);
    expect(evaluateEligibility).toHaveBeenCalledTimes(2);
    expect(result.evaluations.map((e) => e.trial.nctId)).toEqual(["A", "B"]);
    expect(result.summary.evaluated).toBe(2);
    expect(result.summary.totalConsidered).toBe(4);
    expect(result.summary.eligible).toBe(2);
  });

  it("surfaces hard-excluded candidates without evaluating them", async () => {
    const candidates = [
      makeCandidate("A"),
      makeCandidate("X", true),
      makeCandidate("Y", true),
    ];
    const parseCriteria = vi.fn().mockResolvedValue(okCriteria);
    const evaluateEligibility = vi
      .fn()
      .mockResolvedValue(makeVerdict("ELIGIBLE"));

    const result = await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      parseCriteria,
      evaluateEligibility,
    });

    expect(parseCriteria).toHaveBeenCalledTimes(1);
    expect(result.hardExcluded.map((r) => r.trial.nctId)).toEqual(["X", "Y"]);
    expect(result.summary.hardExcluded).toBe(2);
  });

  it("captures per-trial errors without killing the run", async () => {
    const candidates = [
      makeCandidate("OK"),
      makeCandidate("PARSE_FAIL"),
      makeCandidate("EVAL_FAIL"),
    ];
    const parseCriteria = vi.fn(async (text: string) => {
      // We can't tell which trial we're on from text alone in fakes, so
      // count calls to vary behavior.
      const call = parseCriteria.mock.calls.length;
      if (call === 2) throw new Error("parse exploded");
      void text;
      return okCriteria;
    });
    const evaluateEligibility = vi.fn(async () => {
      const call = evaluateEligibility.mock.calls.length;
      if (call === 2) throw new Error("evaluator exploded");
      return makeVerdict("ELIGIBLE");
    });

    const result = await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      concurrency: 1, // deterministic call order
      parseCriteria,
      evaluateEligibility,
    });

    expect(result.evaluations).toHaveLength(3);
    const byNct = Object.fromEntries(
      result.evaluations.map((e) => [e.trial.nctId, e]),
    );
    expect(byNct.OK.verdict?.verdict).toBe("ELIGIBLE");
    expect(byNct.PARSE_FAIL.verdict).toBeNull();
    expect(byNct.PARSE_FAIL.error).toMatch(/parse exploded/);
    expect(byNct.EVAL_FAIL.verdict).toBeNull();
    expect(byNct.EVAL_FAIL.error).toMatch(/evaluator exploded/);
    expect(result.summary.errors).toBe(2);
    expect(result.summary.eligible).toBe(1);
  });

  it("treats empty parsed criteria as an error", async () => {
    const candidates = [makeCandidate("A")];
    const parseCriteria = vi.fn().mockResolvedValue([]);
    const evaluateEligibility = vi.fn();

    const result = await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      parseCriteria,
      evaluateEligibility,
    });

    expect(evaluateEligibility).not.toHaveBeenCalled();
    expect(result.evaluations[0].error).toMatch(/No criteria could be parsed/);
    expect(result.summary.errors).toBe(1);
  });

  it("calls onProgress and onTrialComplete for every evaluation", async () => {
    const candidates = [makeCandidate("A"), makeCandidate("B")];
    const parseCriteria = vi.fn().mockResolvedValue(okCriteria);
    const evaluateEligibility = vi
      .fn()
      .mockResolvedValue(makeVerdict("ELIGIBLE"));
    const onProgress = vi.fn();
    const onTrialComplete = vi.fn();

    await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      parseCriteria,
      evaluateEligibility,
      onProgress,
      onTrialComplete,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onTrialComplete).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2, expect.any(String));
  });

  it("limits concurrency so no more than N evals run at once", async () => {
    const total = 6;
    const concurrency = 2;
    let inFlight = 0;
    let peak = 0;

    const candidates = Array.from({ length: total }, (_, i) =>
      makeCandidate(`T${i}`),
    );
    const parseCriteria = vi.fn().mockResolvedValue(okCriteria);
    const evaluateEligibility = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return makeVerdict("ELIGIBLE");
    });

    await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      concurrency,
      maxTrials: total,
      parseCriteria,
      evaluateEligibility,
    });

    expect(peak).toBeLessThanOrEqual(concurrency);
    expect(evaluateEligibility).toHaveBeenCalledTimes(total);
  });

  it("populates summary counts across all verdict buckets", async () => {
    const candidates = [
      makeCandidate("E1"),
      makeCandidate("E2"),
      makeCandidate("I1"),
      makeCandidate("N1"),
    ];
    const parseCriteria = vi.fn().mockResolvedValue(okCriteria);
    const verdictByCall: Verdict[] = [
      "ELIGIBLE",
      "ELIGIBLE",
      "INELIGIBLE",
      "NEEDS_MORE_DATA",
    ];
    const evaluateEligibility = vi.fn(async () => {
      const call = evaluateEligibility.mock.calls.length - 1;
      return makeVerdict(verdictByCall[call]);
    });

    const result = await evaluatePatientAgainstTrials(emptyBundle, candidates, {
      concurrency: 1,
      parseCriteria,
      evaluateEligibility,
    });

    expect(result.summary.eligible).toBe(2);
    expect(result.summary.ineligible).toBe(1);
    expect(result.summary.needsMoreData).toBe(1);
    expect(result.summary.errors).toBe(0);
  });
});
