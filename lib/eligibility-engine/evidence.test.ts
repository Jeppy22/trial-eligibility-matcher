import { describe, expect, it } from "vitest";

import type { FHIRBundle } from "../types";
import bundleJson from "../../sample-data/patient-bundle.json";
import { gatherEvidence } from "./evidence";

const bundle = bundleJson as FHIRBundle;
const emptyBundle: FHIRBundle = { resourceType: "Bundle", entry: [] };

describe("gatherEvidence", () => {
  it("returns one Patient resource for ['Patient']", () => {
    const ev = gatherEvidence(bundle, ["Patient"]);
    expect(ev).toHaveLength(1);
    expect(ev[0].resourceType).toBe("Patient");
    expect(ev[0].id).toBe("patient-001");
  });

  it("returns both T2DM and hypertension conditions for ['Condition']", () => {
    const ev = gatherEvidence(bundle, ["Condition"]);
    expect(ev.length).toBeGreaterThanOrEqual(2);
    const ids = ev.map((r) => r.id);
    expect(ids).toContain("condition-htn");
    expect(ids).toContain("condition-t2dm");
    for (const r of ev) expect(r.resourceType).toBe("Condition");
  });

  it("returns Patient + Observation deduplicated for ['Patient', 'Observation']", () => {
    const ev = gatherEvidence(bundle, ["Patient", "Observation"]);
    const types = ev.map((r) => r.resourceType);
    expect(types).toContain("Patient");
    expect(types).toContain("Observation");
    const keys = ev.map((r) => `${r.resourceType}/${r.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("dedupes when the same resource type is requested twice", () => {
    const once = gatherEvidence(bundle, ["Condition"]);
    const twice = gatherEvidence(bundle, ["Condition", "Condition"]);
    expect(twice).toHaveLength(once.length);
  });

  it("returns [] for empty requiredData", () => {
    expect(gatherEvidence(bundle, [])).toEqual([]);
  });

  it("returns [] for an empty bundle regardless of requiredData", () => {
    expect(
      gatherEvidence(emptyBundle, [
        "Patient",
        "Condition",
        "Observation",
        "MedicationRequest",
        "Procedure",
      ]),
    ).toEqual([]);
  });
});
