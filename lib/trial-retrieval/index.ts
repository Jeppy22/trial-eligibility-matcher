import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  Condition,
  FHIRBundle,
  RetrievalResult,
  Trial,
} from "../types";
import { getAge, getConditions, getGender } from "../fhir-query/queries";

let cachedTrials: Trial[] | null = null;

export function loadTrials(): Trial[] {
  if (cachedTrials) return cachedTrials;
  const path = join(process.cwd(), "data", "trials.json");
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Trial[];
  cachedTrials = parsed;
  return parsed;
}

function conditionNames(condition: Condition): string[] {
  const out: string[] = [];
  if (condition.code?.text) out.push(condition.code.text);
  for (const coding of condition.code?.coding ?? []) {
    if (coding.display) out.push(coding.display);
  }
  return out;
}

function sexMatches(trialSex: Trial["sex"], gender: string | null): boolean {
  if (trialSex === "ALL") return true;
  if (!gender) return true;
  return trialSex.toLowerCase() === gender.toLowerCase();
}

function evaluateTrial(
  trial: Trial,
  age: number | null,
  gender: string | null,
  patientConditionTexts: string[],
): RetrievalResult {
  if (!sexMatches(trial.sex, gender)) {
    return {
      trial,
      score: 0,
      reasons: [],
      hardExcluded: true,
      exclusionReason: `Trial requires ${trial.sex} patients`,
    };
  }

  if (age !== null && trial.minimumAge !== null && age < trial.minimumAge) {
    return {
      trial,
      score: 0,
      reasons: [],
      hardExcluded: true,
      exclusionReason: `Patient is ${age}, trial requires minimum ${trial.minimumAge}`,
    };
  }

  if (age !== null && trial.maximumAge !== null && age > trial.maximumAge) {
    return {
      trial,
      score: 0,
      reasons: [],
      hardExcluded: true,
      exclusionReason: `Patient is ${age}, trial maximum is ${trial.maximumAge}`,
    };
  }

  const reasons: string[] = [];
  let score = 0;

  for (const trialCondition of trial.conditions) {
    const needle = trialCondition.toLowerCase();
    const matched = patientConditionTexts.some((t) =>
      t.toLowerCase().includes(needle),
    );
    if (matched) {
      score += 10;
      reasons.push(`Patient has ${trialCondition}`);
    }
  }

  if (trial.phase === "PHASE2" || trial.phase === "PHASE3") {
    score += 3;
  }

  if (trial.healthyVolunteers) {
    score += 1;
  }

  return { trial, score, reasons, hardExcluded: false };
}

export function filterTrialsForPatient(
  bundle: FHIRBundle,
  trials: Trial[],
): RetrievalResult[] {
  const age = getAge(bundle);
  const gender = getGender(bundle);
  const patientConditionTexts: string[] = [];
  for (const c of getConditions(bundle)) {
    patientConditionTexts.push(...conditionNames(c));
  }

  const results = trials.map((t) =>
    evaluateTrial(t, age, gender, patientConditionTexts),
  );

  results.sort((a, b) => {
    if (a.hardExcluded !== b.hardExcluded) return a.hardExcluded ? 1 : -1;
    if (a.hardExcluded && b.hardExcluded) {
      return a.trial.title.localeCompare(b.trial.title);
    }
    return b.score - a.score;
  });

  return results;
}

export function top(results: RetrievalResult[], n: number): RetrievalResult[] {
  return results.filter((r) => !r.hardExcluded).slice(0, n);
}
