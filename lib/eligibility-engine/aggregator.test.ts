import { describe, expect, it } from "vitest";

import type { Criterion, MatchResult, MatchStatus } from "../types";
import { aggregateVerdict } from "./aggregator";

function mkResult(
  id: string,
  type: "inclusion" | "exclusion",
  status: MatchStatus,
): MatchResult {
  const criterion: Criterion = {
    id,
    text: `criterion ${id}`,
    type,
    requiredData: ["Patient"],
  };
  return {
    criterion,
    status,
    evidence: [],
    reasoning: `test reasoning for ${id}`,
  };
}

describe("aggregateVerdict", () => {
  it("returns ELIGIBLE when all inclusions are met and no exclusions are met", () => {
    const v = aggregateVerdict([
      mkResult("C1", "inclusion", "met"),
      mkResult("C2", "inclusion", "met"),
      mkResult("C3", "exclusion", "not_met"),
    ]);
    expect(v.verdict).toBe("ELIGIBLE");
    expect(v.gaps).toEqual([]);
    expect(v.criteria_results).toHaveLength(3);
  });

  it("returns INELIGIBLE when an exclusion is met (patient has the excluded condition)", () => {
    const v = aggregateVerdict([
      mkResult("C1", "inclusion", "met"),
      mkResult("C2", "exclusion", "met"),
    ]);
    expect(v.verdict).toBe("INELIGIBLE");
    expect(v.gaps).toEqual([]);
  });

  it("returns INELIGIBLE when an inclusion is not_met", () => {
    const v = aggregateVerdict([
      mkResult("C1", "inclusion", "met"),
      mkResult("C2", "inclusion", "not_met"),
      mkResult("C3", "exclusion", "not_met"),
    ]);
    expect(v.verdict).toBe("INELIGIBLE");
    expect(v.gaps).toEqual([]);
  });

  it("returns NEEDS_MORE_DATA when any criterion is needs_more_data, with that criterion in gaps", () => {
    const v = aggregateVerdict([
      mkResult("C1", "inclusion", "met"),
      mkResult("C2", "inclusion", "needs_more_data"),
      mkResult("C3", "exclusion", "not_met"),
    ]);
    expect(v.verdict).toBe("NEEDS_MORE_DATA");
    expect(v.gaps).toEqual(["[C2] criterion C2"]);
  });

  it("prioritizes NEEDS_MORE_DATA over a met exclusion (need more info before declaring ineligible)", () => {
    const v = aggregateVerdict([
      mkResult("C1", "exclusion", "met"), // would yield INELIGIBLE on its own
      mkResult("C2", "inclusion", "needs_more_data"),
    ]);
    expect(v.verdict).toBe("NEEDS_MORE_DATA");
    expect(v.gaps).toContain("[C2] criterion C2");
  });

  // NOTE: An empty criteria list is vacuously eligible — "all of nothing is true".
  // Flagged here because callers may want to treat zero criteria as an upstream
  // parsing error rather than a green light. The engine itself does not.
  it("returns ELIGIBLE for empty criteria (vacuous truth)", () => {
    const v = aggregateVerdict([]);
    expect(v.verdict).toBe("ELIGIBLE");
    expect(v.gaps).toEqual([]);
    expect(v.criteria_results).toEqual([]);
  });

  it("lists multiple gaps in encounter order", () => {
    const v = aggregateVerdict([
      mkResult("C1", "inclusion", "needs_more_data"),
      mkResult("C2", "inclusion", "met"),
      mkResult("C3", "exclusion", "needs_more_data"),
    ]);
    expect(v.verdict).toBe("NEEDS_MORE_DATA");
    expect(v.gaps).toEqual(["[C1] criterion C1", "[C3] criterion C3"]);
  });
});
