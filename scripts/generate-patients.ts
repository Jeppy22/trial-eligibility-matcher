/**
 * Run Synthea to generate 10 Massachusetts patients, copy each patient's
 * FHIR Bundle into /public/sample-patients/{id}.json, and write a manifest
 * with one PatientSummary per patient.
 *
 * Run with: npx tsx scripts/generate-patients.ts
 *
 * Env:
 *   SYNTHEA_JAR_PATH  Path to synthea-with-dependencies.jar
 *                     (default: C:\dev\fhir-ai\synthea\synthea-with-dependencies.jar)
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  Condition,
  FHIRBundle,
  Patient,
  PatientSummary,
} from "../lib/types";

const DEFAULT_JAR = "C:\\dev\\fhir-ai\\synthea\\synthea-with-dependencies.jar";
const SYNTHEA_OUT_DIR = join(process.cwd(), "synthea-output");
const FHIR_OUT_DIR = join(SYNTHEA_OUT_DIR, "fhir");
const PUBLIC_OUT_DIR = join(process.cwd(), "public", "sample-patients");
const POPULATION = 10;

function runSynthea(jarPath: string): void {
  if (!existsSync(jarPath)) {
    throw new Error(
      `Synthea jar not found at ${jarPath}. Set SYNTHEA_JAR_PATH env var.`,
    );
  }
  console.log(`Running Synthea (population=${POPULATION}, state=Massachusetts)...`);
  const result = spawnSync(
    "java",
    [
      "-jar",
      jarPath,
      "-p",
      String(POPULATION),
      "--exporter.fhir.export",
      "true",
      "--exporter.baseDirectory",
      SYNTHEA_OUT_DIR,
      "Massachusetts",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`Synthea exited with status ${result.status}`);
  }
}

function isPatientBundleFile(name: string): boolean {
  if (!name.endsWith(".json")) return false;
  if (name.startsWith("hospitalInformation")) return false;
  if (name.startsWith("practitionerInformation")) return false;
  return true;
}

function ageFromBirthDate(birthDate: string | undefined): number {
  if (!birthDate) return 0;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  const dayDelta = now.getUTCDate() - birth.getUTCDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1;
  return age;
}

function stripSyntheaSuffix(name: string | undefined): string {
  if (!name) return "";
  // Synthea names like "John123" — drop trailing digits.
  return name.replace(/\d+$/, "");
}

function displayName(patient: Patient): string {
  const first = stripSyntheaSuffix(patient.name?.[0]?.given?.[0]);
  const family = stripSyntheaSuffix(patient.name?.[0]?.family);
  const lastInitial = family ? `${family[0]}.` : "";
  return [first, lastInitial].filter(Boolean).join(" ") || "Unknown";
}

function isActive(c: Condition): boolean {
  return (
    c.clinicalStatus?.coding?.some((code) => code.code === "active") ?? false
  );
}

function conditionName(c: Condition): string {
  return (
    c.code?.text ??
    c.code?.coding?.find((cc) => cc.display)?.display ??
    "Unknown condition"
  );
}

function summarize(bundle: FHIRBundle): PatientSummary | null {
  const patient = bundle.entry
    .map((e) => e.resource)
    .find((r): r is Patient => r?.resourceType === "Patient");
  if (!patient) return null;

  const conditions: Condition[] = [];
  let observationCount = 0;
  let medicationCount = 0;
  let procedureCount = 0;
  for (const entry of bundle.entry) {
    const r = entry.resource;
    switch (r?.resourceType) {
      case "Condition":
        conditions.push(r as Condition);
        break;
      case "Observation":
        observationCount++;
        break;
      case "MedicationRequest":
        medicationCount++;
        break;
      case "Procedure":
        procedureCount++;
        break;
    }
  }

  const activeConditions = conditions.filter(isActive);
  const topConditions = activeConditions.slice(0, 3).map(conditionName);

  return {
    id: patient.id,
    displayName: displayName(patient),
    age: ageFromBirthDate(patient.birthDate),
    gender: patient.gender ?? "unknown",
    conditionCount: conditions.length,
    observationCount,
    medicationCount,
    procedureCount,
    topConditions,
  };
}

function main(): void {
  const jarPath = process.env.SYNTHEA_JAR_PATH ?? DEFAULT_JAR;
  runSynthea(jarPath);

  if (!existsSync(FHIR_OUT_DIR)) {
    throw new Error(`Expected FHIR output dir not found: ${FHIR_OUT_DIR}`);
  }

  mkdirSync(PUBLIC_OUT_DIR, { recursive: true });

  const files = readdirSync(FHIR_OUT_DIR).filter(isPatientBundleFile);
  const summaries: PatientSummary[] = [];

  for (const file of files) {
    const fullPath = join(FHIR_OUT_DIR, file);
    let bundle: FHIRBundle;
    try {
      bundle = JSON.parse(readFileSync(fullPath, "utf-8")) as FHIRBundle;
    } catch (err) {
      console.warn(`  skip ${file}: parse error — ${(err as Error).message}`);
      continue;
    }
    const summary = summarize(bundle);
    if (!summary) {
      console.warn(`  skip ${file}: no Patient resource`);
      continue;
    }
    const destPath = join(PUBLIC_OUT_DIR, `${summary.id}.json`);
    copyFileSync(fullPath, destPath);
    summaries.push(summary);
  }

  const manifestPath = join(PUBLIC_OUT_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(summaries, null, 2), "utf-8");

  console.log("\n=== Patient generation summary ===");
  console.log(`Wrote ${summaries.length} bundles to ${PUBLIC_OUT_DIR}`);
  console.log(`Manifest: ${manifestPath}\n`);

  const header = ["ID", "Name", "Age", "Gender", "Conditions"];
  const rows = summaries.map((s) => [
    s.id.slice(0, 8),
    s.displayName,
    String(s.age),
    s.gender,
    String(s.conditionCount),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(pad(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(pad(row));
  console.log(
    "\nNote: ./synthea-output/ is gitignored; safe to keep or delete.",
  );
}

main();
