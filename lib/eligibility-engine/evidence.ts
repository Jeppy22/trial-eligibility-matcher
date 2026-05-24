import type {
  FHIRBundle,
  FHIRResource,
  FHIRResourceType,
} from "../types";
import {
  getConditions,
  getMedicationRequests,
  getObservations,
  getPatient,
  getProcedures,
} from "../fhir-query";

export function gatherEvidence(
  bundle: FHIRBundle,
  requiredData: FHIRResourceType[],
): FHIRResource[] {
  const collected: FHIRResource[] = [];

  for (const type of requiredData) {
    switch (type) {
      case "Patient": {
        const p = getPatient(bundle);
        if (p) collected.push(p);
        break;
      }
      case "Condition":
        collected.push(...getConditions(bundle));
        break;
      case "Observation":
        collected.push(...getObservations(bundle));
        break;
      case "MedicationRequest":
        collected.push(...getMedicationRequests(bundle));
        break;
      case "Procedure":
        collected.push(...getProcedures(bundle));
        break;
    }
  }

  const seen = new Set<string>();
  const deduped: FHIRResource[] = [];
  for (const r of collected) {
    const key = `${r.resourceType}/${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}
