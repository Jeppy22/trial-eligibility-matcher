import { describe, expect, it } from "vitest";

import type {
  FHIRBundle,
  Observation,
  Patient,
} from "../types";
import bundleJson from "../../sample-data/patient-bundle.json";
import {
  daysSinceProcedure,
  getAge,
  getConditions,
  getGender,
  getLatestObservation,
  getMedicationRequests,
  getObservationValue,
  getObservations,
  getPatient,
  getProcedures,
  hasActiveCondition,
  hasActiveMedication,
  hasMedicationContaining,
} from "./queries";

const bundle = bundleJson as FHIRBundle;
const ASOF = new Date("2026-05-24T00:00:00Z");

const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

const T2DM = "44054006";
const HTN = "59621000";
const HBA1C = "4548-4";
const COLONOSCOPY = "73761001";
const METFORMIN_RXNORM = "860975";

const emptyBundle: FHIRBundle = { resourceType: "Bundle", entry: [] };

describe("getPatient", () => {
  it("returns the patient from a populated bundle", () => {
    const patient = getPatient(bundle);
    expect(patient).not.toBeNull();
    expect(patient?.resourceType).toBe("Patient");
    expect(patient?.id).toBe("patient-001");
  });

  it("returns null when the bundle has no Patient resource", () => {
    expect(getPatient(emptyBundle)).toBeNull();
  });
});

describe("getAge", () => {
  it("computes age 55 for a 1971-03-15 birthdate on 2026-05-24", () => {
    expect(getAge(bundle, ASOF)).toBe(55);
  });

  it("returns null when the bundle has no patient", () => {
    expect(getAge(emptyBundle, ASOF)).toBeNull();
  });

  it("returns null when the patient is missing birthDate", () => {
    const noBirth: FHIRBundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "p",
          } as Patient,
        },
      ],
    };
    expect(getAge(noBirth, ASOF)).toBeNull();
  });

  it("decrements age when the birthday has not yet occurred this year", () => {
    const decemberBaby: FHIRBundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "p",
            birthDate: "1971-12-15",
          },
        },
      ],
    };
    expect(getAge(decemberBaby, ASOF)).toBe(54);
  });
});

describe("getGender", () => {
  it("returns 'male' for the sample patient", () => {
    expect(getGender(bundle)).toBe("male");
  });

  it("returns null on an empty bundle", () => {
    expect(getGender(emptyBundle)).toBeNull();
  });
});

describe("getConditions", () => {
  it("returns all conditions when activeOnly is not set", () => {
    expect(getConditions(bundle).length).toBeGreaterThanOrEqual(2);
  });

  it("filters to active conditions when activeOnly is true", () => {
    const active = getConditions(bundle, { activeOnly: true });
    expect(active.length).toBeGreaterThanOrEqual(2);
    for (const c of active) {
      expect(c.clinicalStatus?.coding?.some((cd) => cd.code === "active")).toBe(true);
    }
  });

  it("returns [] on an empty bundle", () => {
    expect(getConditions(emptyBundle)).toEqual([]);
    expect(getConditions(emptyBundle, { activeOnly: true })).toEqual([]);
  });
});

describe("hasActiveCondition", () => {
  it("returns true for the T2DM SNOMED code", () => {
    expect(hasActiveCondition(bundle, T2DM, SNOMED)).toBe(true);
  });

  it("returns true for hypertension SNOMED code", () => {
    expect(hasActiveCondition(bundle, HTN, SNOMED)).toBe(true);
  });

  it("returns false for a code that is not present", () => {
    expect(hasActiveCondition(bundle, "00000000", SNOMED)).toBe(false);
  });

  it("returns false when the wrong code system is supplied", () => {
    expect(hasActiveCondition(bundle, T2DM, "http://example.com/wrong")).toBe(false);
  });

  it("returns false on an empty bundle", () => {
    expect(hasActiveCondition(emptyBundle, T2DM, SNOMED)).toBe(false);
  });
});

describe("getObservations", () => {
  it("returns all observations when no filter is provided", () => {
    expect(getObservations(bundle).length).toBeGreaterThanOrEqual(1);
  });

  it("filters by LOINC HbA1c code", () => {
    const matches = getObservations(bundle, { code: HBA1C, system: LOINC });
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("observation-hba1c");
  });

  it("returns [] for a code not present", () => {
    expect(getObservations(bundle, { code: "00000-0" })).toEqual([]);
  });
});

describe("getLatestObservation", () => {
  it("returns the HbA1c observation by LOINC code", () => {
    const obs = getLatestObservation(bundle, HBA1C, LOINC);
    expect(obs).not.toBeNull();
    expect(obs?.id).toBe("observation-hba1c");
  });

  it("returns the most recent when multiple observations match", () => {
    const multi: FHIRBundle = {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Observation",
            id: "older",
            status: "final",
            code: { coding: [{ system: LOINC, code: HBA1C }] },
            subject: { reference: "Patient/p" },
            effectiveDateTime: "2025-01-10",
            valueQuantity: { value: 8.1, unit: "%" },
          },
        },
        {
          resource: {
            resourceType: "Observation",
            id: "newer",
            status: "final",
            code: { coding: [{ system: LOINC, code: HBA1C }] },
            subject: { reference: "Patient/p" },
            effectiveDateTime: "2026-03-18",
            valueQuantity: { value: 7.2, unit: "%" },
          },
        },
      ],
    };
    expect(getLatestObservation(multi, HBA1C, LOINC)?.id).toBe("newer");
  });

  it("returns null when no observation matches", () => {
    expect(getLatestObservation(bundle, "00000-0", LOINC)).toBeNull();
    expect(getLatestObservation(emptyBundle, HBA1C, LOINC)).toBeNull();
  });
});

describe("getObservationValue", () => {
  it("returns { value: 7.2, unit: '%' } for the sample HbA1c", () => {
    const obs = getLatestObservation(bundle, HBA1C, LOINC)!;
    expect(getObservationValue(obs)).toEqual({ value: 7.2, unit: "%" });
  });

  it("returns null when the observation has no valueQuantity", () => {
    const obs: Observation = {
      resourceType: "Observation",
      id: "no-value",
      status: "final",
      code: { coding: [{ system: LOINC, code: HBA1C }] },
      subject: { reference: "Patient/p" },
    };
    expect(getObservationValue(obs)).toBeNull();
  });
});

describe("getMedicationRequests", () => {
  it("returns all medication requests when activeOnly is not set", () => {
    expect(getMedicationRequests(bundle).length).toBeGreaterThanOrEqual(1);
  });

  it("filters to active medications when activeOnly is true", () => {
    const active = getMedicationRequests(bundle, { activeOnly: true });
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const m of active) expect(m.status).toBe("active");
  });

  it("returns [] on an empty bundle", () => {
    expect(getMedicationRequests(emptyBundle)).toEqual([]);
  });
});

describe("hasActiveMedication", () => {
  it("returns true for metformin by RxNorm code", () => {
    expect(hasActiveMedication(bundle, METFORMIN_RXNORM, RXNORM)).toBe(true);
  });

  it("returns false for a code not present", () => {
    expect(hasActiveMedication(bundle, "0", RXNORM)).toBe(false);
  });
});

describe("hasMedicationContaining", () => {
  it("returns true for /metformin/i", () => {
    expect(hasMedicationContaining(bundle, /metformin/i)).toBe(true);
  });

  it("returns false for /aspirin/i", () => {
    expect(hasMedicationContaining(bundle, /aspirin/i)).toBe(false);
  });

  it("returns false on an empty bundle", () => {
    expect(hasMedicationContaining(emptyBundle, /metformin/i)).toBe(false);
  });
});

describe("getProcedures", () => {
  it("returns the colonoscopy when filtered by SNOMED code", () => {
    const procs = getProcedures(bundle, { code: COLONOSCOPY });
    expect(procs).toHaveLength(1);
    expect(procs[0].id).toBe("procedure-colonoscopy");
  });

  it("returns [] on an empty bundle", () => {
    expect(getProcedures(emptyBundle)).toEqual([]);
  });
});

describe("daysSinceProcedure", () => {
  it("returns ~762 days for the colonoscopy performed on 2024-04-22 against asOf 2026-05-24", () => {
    const days = daysSinceProcedure(bundle, COLONOSCOPY, SNOMED, ASOF);
    expect(days).not.toBeNull();
    // Calendar math: 2024-04-22 → 2026-05-24 = 762 days. Allow ±2 for any TZ rounding.
    expect(days).toBeGreaterThanOrEqual(760);
    expect(days).toBeLessThanOrEqual(765);
  });

  it("returns null when no procedure matches", () => {
    expect(daysSinceProcedure(bundle, "00000000", SNOMED, ASOF)).toBeNull();
    expect(daysSinceProcedure(emptyBundle, COLONOSCOPY, SNOMED, ASOF)).toBeNull();
  });
});
