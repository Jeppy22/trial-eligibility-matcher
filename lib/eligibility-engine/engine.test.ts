import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import type { Criterion, FHIRBundle, MatchResult, MatchStatus } from "../types";
import bundleJson from "../../sample-data/patient-bundle.json";

const { mockEvaluateCriterion } = vi.hoisted(() => ({
  mockEvaluateCriterion: vi.fn(),
}));

vi.mock("./evaluator", () => ({
  evaluateCriterion: mockEvaluateCriterion,
}));

import { evaluateEligibility } from "./engine";

const bundle = bundleJson as FHIRBundle;

const c1: Criterion = {
  id: "C1",
  text: "Adults aged 45-75",
  type: "inclusion",
  requiredData: ["Patient"],
};
const c2: Criterion = {
  id: "C2",
  text: "Diagnosis of T2DM",
  type: "inclusion",
  requiredData: ["Condition"],
};
const c3: Criterion = {
  id: "C3",
  text: "History of MI",
  type: "exclusion",
  requiredData: ["Condition"],
};

function mkResult(criterion: Criterion, status: MatchStatus): MatchResult {
  return {
    criterion,
    status,
    evidence: [],
    reasoning: `mock ${status}`,
  };
}

describe("evaluateEligibility — unit (mocked evaluator)", () => {
  beforeEach(() => {
    mockEvaluateCriterion.mockReset();
  });

  it("returns ELIGIBLE when all criteria resolve to met (inclusions) / not_met (exclusions)", async () => {
    mockEvaluateCriterion
      .mockResolvedValueOnce(mkResult(c1, "met"))
      .mockResolvedValueOnce(mkResult(c2, "met"))
      .mockResolvedValueOnce(mkResult(c3, "not_met"));
    const verdict = await evaluateEligibility(bundle, [c1, c2, c3]);
    expect(verdict.verdict).toBe("ELIGIBLE");
    expect(verdict.criteria_results).toHaveLength(3);
    expect(verdict.gaps).toEqual([]);
  });

  it("returns NEEDS_MORE_DATA when any criterion is needs_more_data", async () => {
    mockEvaluateCriterion
      .mockResolvedValueOnce(mkResult(c1, "met"))
      .mockResolvedValueOnce(mkResult(c2, "needs_more_data"));
    const verdict = await evaluateEligibility(bundle, [c1, c2]);
    expect(verdict.verdict).toBe("NEEDS_MORE_DATA");
    expect(verdict.gaps).toEqual(["[C2] Diagnosis of T2DM"]);
    expect(mockEvaluateCriterion).toHaveBeenCalledTimes(2);
  });

  it("returns INELIGIBLE when an exclusion is met", async () => {
    mockEvaluateCriterion
      .mockResolvedValueOnce(mkResult(c1, "met"))
      .mockResolvedValueOnce(mkResult(c2, "met"))
      .mockResolvedValueOnce(mkResult(c3, "met"));
    const verdict = await evaluateEligibility(bundle, [c1, c2, c3]);
    expect(verdict.verdict).toBe("INELIGIBLE");
  });

  it("calls evaluateCriterion sequentially in criterion order", async () => {
    const callOrder: string[] = [];
    mockEvaluateCriterion.mockImplementation(async (criterion: Criterion) => {
      callOrder.push(`start:${criterion.id}`);
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push(`end:${criterion.id}`);
      return mkResult(criterion, "met");
    });

    await evaluateEligibility(bundle, [c1, c2, c3]);

    expect(callOrder).toEqual([
      "start:C1",
      "end:C1",
      "start:C2",
      "end:C2",
      "start:C3",
      "end:C3",
    ]);
  });

  it("passes gathered evidence matching the criterion's requiredData", async () => {
    mockEvaluateCriterion.mockResolvedValue(mkResult(c1, "met"));
    await evaluateEligibility(bundle, [c1]);
    const [calledCriterion, calledEvidence] =
      mockEvaluateCriterion.mock.calls[0];
    expect(calledCriterion).toBe(c1);
    expect(calledEvidence.length).toBeGreaterThan(0);
    expect(calledEvidence[0].resourceType).toBe("Patient");
  });

  it("returns ELIGIBLE for an empty criteria list (vacuous)", async () => {
    const verdict = await evaluateEligibility(bundle, []);
    expect(verdict.verdict).toBe("ELIGIBLE");
    expect(verdict.criteria_results).toEqual([]);
    expect(mockEvaluateCriterion).not.toHaveBeenCalled();
  });
});

describe("evaluateEligibility — integration (real Anthropic API)", () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.RUN_INTEGRATION_TESTS)(
    "parses sample trial criteria and evaluates against the sample patient bundle end-to-end",
    async () => {
      vi.doUnmock("./evaluator");
      vi.resetModules();
      const { evaluateEligibility: realEvaluate } = await import("./engine");
      const { parseCriteria } = await import("../criteria-parser");

      const criteriaText = fs.readFileSync(
        path.resolve(process.cwd(), "sample-data", "trial-criteria.txt"),
        "utf-8",
      );
      const criteria = await parseCriteria(criteriaText);
      const verdict = await realEvaluate(bundle, criteria);

      expect(["ELIGIBLE", "INELIGIBLE", "NEEDS_MORE_DATA"]).toContain(
        verdict.verdict,
      );
      expect(verdict.criteria_results).toHaveLength(criteria.length);
    },
    180_000,
  );
});
