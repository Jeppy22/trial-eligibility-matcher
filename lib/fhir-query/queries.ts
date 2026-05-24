import type {
  CodeableConcept,
  Condition,
  FHIRBundle,
  FHIRResource,
  MedicationRequest,
  Observation,
  Patient,
  Procedure,
} from "../types";

// ---------- Internal helpers ----------

function resourcesOfType<T extends FHIRResource>(
  bundle: FHIRBundle,
  type: T["resourceType"],
): T[] {
  const entries = bundle?.entry ?? [];
  const out: T[] = [];
  for (const entry of entries) {
    const r = entry?.resource;
    if (r && r.resourceType === type) out.push(r as T);
  }
  return out;
}

function hasCoding(
  concept: CodeableConcept | undefined,
  code: string,
  system?: string,
): boolean {
  const codings = concept?.coding;
  if (!codings) return false;
  for (const c of codings) {
    if (c.code !== code) continue;
    if (system !== undefined && c.system !== system) continue;
    return true;
  }
  return false;
}

function isActiveCondition(c: Condition): boolean {
  const codings = c.clinicalStatus?.coding;
  if (!codings) return false;
  return codings.some((coding) => coding.code === "active");
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- Core extractors ----------

export function getPatient(bundle: FHIRBundle): Patient | null {
  return resourcesOfType<Patient>(bundle, "Patient")[0] ?? null;
}

export function getConditions(
  bundle: FHIRBundle,
  opts: { activeOnly?: boolean } = {},
): Condition[] {
  const conditions = resourcesOfType<Condition>(bundle, "Condition");
  return opts.activeOnly ? conditions.filter(isActiveCondition) : conditions;
}

export function getObservations(
  bundle: FHIRBundle,
  opts: { code?: string; system?: string } = {},
): Observation[] {
  const observations = resourcesOfType<Observation>(bundle, "Observation");
  if (opts.code === undefined) return observations;
  return observations.filter((o) => hasCoding(o.code, opts.code!, opts.system));
}

export function getMedicationRequests(
  bundle: FHIRBundle,
  opts: { activeOnly?: boolean } = {},
): MedicationRequest[] {
  const meds = resourcesOfType<MedicationRequest>(bundle, "MedicationRequest");
  return opts.activeOnly ? meds.filter((m) => m.status === "active") : meds;
}

export function getProcedures(
  bundle: FHIRBundle,
  opts: { code?: string } = {},
): Procedure[] {
  const procs = resourcesOfType<Procedure>(bundle, "Procedure");
  if (opts.code === undefined) return procs;
  return procs.filter((p) => hasCoding(p.code, opts.code!));
}

// ---------- Derived facts ----------

export function getAge(bundle: FHIRBundle, asOf: Date = new Date()): number | null {
  const patient = getPatient(bundle);
  const birth = parseDate(patient?.birthDate);
  if (!birth) return null;
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - birth.getUTCMonth();
  const dayDelta = asOf.getUTCDate() - birth.getUTCDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1;
  return age;
}

export function getGender(bundle: FHIRBundle): Patient["gender"] | null {
  return getPatient(bundle)?.gender ?? null;
}

export function hasActiveCondition(
  bundle: FHIRBundle,
  code: string,
  system?: string,
): boolean {
  return getConditions(bundle, { activeOnly: true }).some((c) =>
    hasCoding(c.code, code, system),
  );
}

export function getLatestObservation(
  bundle: FHIRBundle,
  code: string,
  system?: string,
): Observation | null {
  const matches = getObservations(bundle, { code, system });
  if (matches.length === 0) return null;
  let latest = matches[0];
  let latestTime = parseDate(latest.effectiveDateTime)?.getTime() ?? -Infinity;
  for (let i = 1; i < matches.length; i++) {
    const t = parseDate(matches[i].effectiveDateTime)?.getTime() ?? -Infinity;
    if (t > latestTime) {
      latest = matches[i];
      latestTime = t;
    }
  }
  return latest;
}

export function getObservationValue(
  obs: Observation,
): { value: number; unit: string } | null {
  const q = obs?.valueQuantity;
  if (!q || typeof q.value !== "number") return null;
  return { value: q.value, unit: q.unit ?? "" };
}

export function hasActiveMedication(
  bundle: FHIRBundle,
  code: string,
  system?: string,
): boolean {
  return getMedicationRequests(bundle, { activeOnly: true }).some((m) =>
    hasCoding(m.medicationCodeableConcept, code, system),
  );
}

export function hasMedicationContaining(
  bundle: FHIRBundle,
  namePattern: RegExp,
): boolean {
  for (const m of getMedicationRequests(bundle)) {
    const concept = m.medicationCodeableConcept;
    if (!concept) continue;
    if (concept.text && namePattern.test(concept.text)) return true;
    if (concept.coding?.some((c) => c.display && namePattern.test(c.display))) {
      return true;
    }
  }
  return false;
}

export function daysSinceProcedure(
  bundle: FHIRBundle,
  code: string,
  system?: string,
  asOf: Date = new Date(),
): number | null {
  const procs = resourcesOfType<Procedure>(bundle, "Procedure").filter((p) =>
    hasCoding(p.code, code, system),
  );
  if (procs.length === 0) return null;
  let mostRecent = -Infinity;
  for (const p of procs) {
    const t = parseDate(p.performedDateTime)?.getTime();
    if (t !== undefined && t > mostRecent) mostRecent = t;
  }
  if (mostRecent === -Infinity) return null;
  return Math.floor((asOf.getTime() - mostRecent) / (1000 * 60 * 60 * 24));
}
