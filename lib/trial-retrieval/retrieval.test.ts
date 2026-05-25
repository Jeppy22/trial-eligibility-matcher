import { describe, expect, it } from "vitest";

import type { Condition, FHIRBundle, Trial } from "../types";
import { filterTrialsForPatient, isClinicalCondition, top } from "./index";

function makeTrial(overrides: Partial<Trial> = {}): Trial {
  return {
    nctId: "NCT00000001",
    title: "Sample Trial",
    conditions: [],
    conditionCodes: [],
    phase: "NA",
    sex: "ALL",
    minimumAge: null,
    maximumAge: null,
    healthyVolunteers: false,
    criteriaText: "Inclusion: adults.",
    focusArea: "test",
    ...overrides,
  };
}

function makePatient(opts: {
  gender?: "male" | "female";
  birthDate?: string;
  conditions?: { text?: string; display?: string }[];
}): FHIRBundle {
  const entries: FHIRBundle["entry"] = [
    {
      resource: {
        resourceType: "Patient",
        id: "p1",
        gender: opts.gender,
        birthDate: opts.birthDate,
      },
    },
  ];
  for (const [i, c] of (opts.conditions ?? []).entries()) {
    entries.push({
      resource: {
        resourceType: "Condition",
        id: `c${i}`,
        clinicalStatus: { coding: [{ code: "active" }] },
        code: {
          text: c.text,
          coding: c.display ? [{ code: "X", display: c.display }] : undefined,
        },
        subject: { reference: "Patient/p1" },
      },
    });
  }
  return { resourceType: "Bundle", entry: entries };
}

// Static birthdate so age is stable irrespective of when the test runs.
// Today is 2026-05-25 per session context; pick birthdates that produce
// known ages.
const BIRTH_AGE_40 = "1985-01-01"; // ~41 in 2026
const BIRTH_AGE_30 = "1995-01-01"; // ~31 in 2026
const BIRTH_AGE_80 = "1945-01-01"; // ~81 in 2026

describe("filterTrialsForPatient — hard exclusions", () => {
  it("excludes male patient from female-only trial", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_40 });
    const trial = makeTrial({ sex: "FEMALE" });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(true);
    expect(result.exclusionReason).toBe("Trial requires FEMALE patients");
    expect(result.score).toBe(0);
  });

  it("excludes patient below minimum age", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_30 });
    const trial = makeTrial({ minimumAge: 65 });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(true);
    expect(result.exclusionReason).toMatch(/minimum 65/);
  });

  it("excludes patient above maximum age", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_80 });
    const trial = makeTrial({ maximumAge: 70 });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(true);
    expect(result.exclusionReason).toMatch(/maximum is 70/);
  });

  it("returns first encountered reason when sex AND age mismatch", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_30 });
    const trial = makeTrial({ sex: "FEMALE", minimumAge: 65 });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(true);
    // Sex is checked first.
    expect(result.exclusionReason).toBe("Trial requires FEMALE patients");
  });
});

describe("filterTrialsForPatient — soft scoring", () => {
  it("adds +10 and a reason per matched condition", () => {
    const patient = makePatient({
      gender: "male",
      birthDate: BIRTH_AGE_40,
      conditions: [{ text: "Type 2 diabetes mellitus" }],
    });
    const trial = makeTrial({ conditions: ["Type 2 diabetes mellitus"] });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(false);
    expect(result.score).toBe(10);
    expect(result.reasons).toContain("Patient has Type 2 diabetes mellitus");
  });

  it("adds +30 when three trial conditions match", () => {
    const patient = makePatient({
      gender: "male",
      birthDate: BIRTH_AGE_40,
      conditions: [
        { text: "Type 2 diabetes mellitus" },
        { display: "Hypertension" },
        { text: "Coronary artery disease" },
      ],
    });
    const trial = makeTrial({
      conditions: [
        "Type 2 diabetes mellitus",
        "Hypertension",
        "Coronary artery disease",
      ],
    });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.score).toBe(30);
    expect(result.reasons).toHaveLength(3);
  });

  it("adds +3 for PHASE3 and 0 for NA", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_40 });
    const phase3 = makeTrial({ nctId: "NCT1", phase: "PHASE3" });
    const na = makeTrial({ nctId: "NCT2", phase: "NA" });
    const results = filterTrialsForPatient(patient, [phase3, na]);
    const phase3Result = results.find((r) => r.trial.nctId === "NCT1")!;
    const naResult = results.find((r) => r.trial.nctId === "NCT2")!;
    expect(phase3Result.score).toBe(3);
    expect(naResult.score).toBe(0);
  });

  it("adds +1 when healthyVolunteers is true", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_40 });
    const trial = makeTrial({ healthyVolunteers: true });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.score).toBe(1);
  });
});

describe("filterTrialsForPatient — sort and edge cases", () => {
  it("sorts higher score first and hard-excluded last", () => {
    const patient = makePatient({
      gender: "male",
      birthDate: BIRTH_AGE_40,
      conditions: [{ text: "Hypertension" }],
    });
    const trials = [
      makeTrial({
        nctId: "NCT-LOW",
        title: "Low",
        conditions: ["Hypertension"],
      }),
      makeTrial({
        nctId: "NCT-HIGH",
        title: "High",
        conditions: ["Hypertension"],
        phase: "PHASE3",
        healthyVolunteers: true,
      }),
      makeTrial({
        nctId: "NCT-EXCL",
        title: "Excl",
        sex: "FEMALE",
      }),
    ];
    const results = filterTrialsForPatient(patient, trials);
    expect(results.map((r) => r.trial.nctId)).toEqual([
      "NCT-HIGH",
      "NCT-LOW",
      "NCT-EXCL",
    ]);
  });

  it("returns empty array when trials array is empty", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_40 });
    expect(filterTrialsForPatient(patient, [])).toEqual([]);
  });

  it("patient with no conditions scores only phase + healthyVolunteers", () => {
    const patient = makePatient({ gender: "male", birthDate: BIRTH_AGE_40 });
    const trial = makeTrial({
      conditions: ["Type 2 diabetes mellitus"],
      phase: "PHASE2",
      healthyVolunteers: true,
    });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.score).toBe(4);
    expect(result.reasons).toEqual([]);
  });
});

describe("isClinicalCondition", () => {
  function makeCondition(text?: string, display?: string): Condition {
    return {
      resourceType: "Condition",
      id: "c0",
      clinicalStatus: { coding: [{ code: "active" }] },
      code: {
        text,
        coding: display ? [{ code: "X", display }] : undefined,
      },
      subject: { reference: "Patient/p1" },
    };
  }

  it("returns false for Synthea administrative findings/situations", () => {
    expect(
      isClinicalCondition(makeCondition("Medication review due (situation)")),
    ).toBe(false);
    expect(
      isClinicalCondition(makeCondition("Received higher education (finding)")),
    ).toBe(false);
    expect(isClinicalCondition(makeCondition("Transport problem"))).toBe(false);
    expect(isClinicalCondition(makeCondition("Stress (finding)"))).toBe(false);
    expect(
      isClinicalCondition(makeCondition(undefined, "Full-time employment")),
    ).toBe(false);
  });

  it("returns true for real clinical diagnoses", () => {
    expect(
      isClinicalCondition(makeCondition("Type 2 diabetes mellitus")),
    ).toBe(true);
    expect(isClinicalCondition(makeCondition("Hypertension"))).toBe(true);
    expect(
      isClinicalCondition(
        makeCondition("Essential hypertension (disorder)"),
      ),
    ).toBe(true);
  });

  it("does not score administrative conditions in retrieval", () => {
    const patient: FHIRBundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "p1",
            gender: "male",
            birthDate: BIRTH_AGE_40,
          },
        },
        {
          resource: {
            resourceType: "Condition",
            id: "c1",
            clinicalStatus: { coding: [{ code: "active" }] },
            code: { text: "Medication review due (situation)" },
            subject: { reference: "Patient/p1" },
          },
        },
      ],
    };
    // Trial whose "conditions" entry contains the administrative string —
    // it should NOT be matched.
    const trial = makeTrial({
      conditions: ["Medication review due (situation)"],
    });
    const [result] = filterTrialsForPatient(patient, [trial]);
    expect(result.hardExcluded).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });
});

describe("top()", () => {
  it("returns up to N non-excluded results in score order", () => {
    const patient = makePatient({
      gender: "male",
      birthDate: BIRTH_AGE_40,
      conditions: [{ text: "Hypertension" }],
    });
    const trials: Trial[] = [];
    for (let i = 0; i < 8; i++) {
      trials.push(
        makeTrial({
          nctId: `NCT-${i}`,
          title: `Trial ${i}`,
          conditions: ["Hypertension"],
          phase: i % 2 === 0 ? "PHASE3" : "NA",
        }),
      );
    }
    trials.push(
      makeTrial({ nctId: "NCT-EXCL", title: "Excl", sex: "FEMALE" }),
    );
    const all = filterTrialsForPatient(patient, trials);
    const five = top(all, 5);
    expect(five).toHaveLength(5);
    expect(five.every((r) => !r.hardExcluded)).toBe(true);
    for (let i = 1; i < five.length; i++) {
      expect(five[i - 1].score).toBeGreaterThanOrEqual(five[i].score);
    }
  });
});
