// FHIR R4 types — intentionally narrow. Only fields the matcher will actually
// read are modeled; anything else from a real Bundle is preserved at runtime
// but not type-checked.

export type FHIRResourceType =
  | "Patient"
  | "Condition"
  | "Observation"
  | "MedicationRequest"
  | "Procedure";

export interface Coding {
  system?: string;
  code: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Quantity {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
  comparator?: "<" | "<=" | ">=" | ">";
}

export interface Reference {
  reference: string;
  display?: string;
}

export interface HumanName {
  use?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
}

export interface Patient {
  resourceType: "Patient";
  id: string;
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string; // YYYY-MM-DD
}

export interface Condition {
  resourceType: "Condition";
  id: string;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  code: CodeableConcept;
  subject: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
}

export type ObservationStatus =
  | "registered"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "cancelled"
  | "entered-in-error"
  | "unknown";

export interface Observation {
  resourceType: "Observation";
  id: string;
  status: ObservationStatus;
  code: CodeableConcept;
  subject: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
  valueCodeableConcept?: CodeableConcept;
}

export type MedicationRequestStatus =
  | "active"
  | "on-hold"
  | "cancelled"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "draft"
  | "unknown";

export interface MedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  status: MedicationRequestStatus;
  intent: string;
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  authoredOn?: string;
}

export type ProcedureStatus =
  | "preparation"
  | "in-progress"
  | "not-done"
  | "on-hold"
  | "stopped"
  | "completed"
  | "entered-in-error"
  | "unknown";

export interface Procedure {
  resourceType: "Procedure";
  id: string;
  status: ProcedureStatus;
  code: CodeableConcept;
  subject: Reference;
  performedDateTime?: string;
}

export type FHIRResource =
  | Patient
  | Condition
  | Observation
  | MedicationRequest
  | Procedure;

export interface BundleEntry {
  fullUrl?: string;
  resource: FHIRResource;
}

export interface FHIRBundle {
  resourceType: "Bundle";
  type?: string;
  entry: BundleEntry[];
}

// Eligibility-matching domain types.

export interface Criterion {
  id: string;
  text: string;
  type: "inclusion" | "exclusion";
  required_data: FHIRResourceType[];
}

export type MatchStatus = "met" | "not_met" | "needs_more_data";

export interface MatchResult {
  criterion: Criterion;
  status: MatchStatus;
  evidence: FHIRResource[];
  reasoning: string;
}

export type Verdict = "ELIGIBLE" | "INELIGIBLE" | "NEEDS_MORE_DATA";

export interface EligibilityVerdict {
  verdict: Verdict;
  criteria_results: MatchResult[];
  gaps: string[];
}
