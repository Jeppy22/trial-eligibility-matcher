/**
 * Fetch a small corpus of recruiting interventional trials from
 * ClinicalTrials.gov API v2 and write the result to /data/trials.json.
 *
 * Run with: npx tsx scripts/ingest-trials.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Trial } from "../lib/types";

const API_URL = "https://clinicaltrials.gov/api/v2/studies";
const PAGE_SIZE = 20;
const REQUEST_DELAY_MS = 500;
const USER_AGENT =
  "trial-eligibility-matcher (Jeff Madden, github.com/Jeppy22/trial-eligibility-matcher)";

const FOCUS_AREAS = [
  "Type 2 diabetes mellitus",
  "Hypertension",
  "Coronary artery disease",
  "Breast cancer screening",
  "Chronic kidney disease",
];

const FIELDS = [
  "NCTId",
  "BriefTitle",
  "Condition",
  "Phase",
  "EligibilityCriteria",
  "MinimumAge",
  "MaximumAge",
  "Sex",
  "HealthyVolunteers",
].join(",");

interface SkipRecord {
  nctId: string;
  reason: string;
  focusArea: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAge(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "n/a") return null;
  const match = trimmed.match(/(\d+(?:\.\d+)?)\s*(year|month|week|day)/i);
  if (!match) {
    const fallback = trimmed.match(/^(\d+)$/);
    return fallback ? Number(fallback[1]) : null;
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "year":
      return Math.round(value);
    case "month":
      return Math.round(value / 12);
    case "week":
      return Math.round(value / 52);
    case "day":
      return Math.round(value / 365);
    default:
      return null;
  }
}

function normalizeSex(raw: unknown): Trial["sex"] {
  if (typeof raw !== "string") return "ALL";
  const up = raw.trim().toUpperCase();
  if (up === "MALE" || up === "FEMALE") return up;
  return "ALL";
}

function normalizePhase(raw: unknown): string {
  if (Array.isArray(raw) && raw.length > 0) {
    return String(raw[0]);
  }
  if (typeof raw === "string") return raw;
  return "NA";
}

function normalizeHealthyVolunteers(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "yes" || v === "true" || v === "y";
  }
  return false;
}

interface StudyJson {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    conditionsModule?: { conditions?: string[] };
    designModule?: { phases?: string[] };
    eligibilityModule?: {
      eligibilityCriteria?: string;
      minimumAge?: string;
      maximumAge?: string;
      sex?: string;
      healthyVolunteers?: boolean;
    };
  };
}

function extractTrial(study: StudyJson, focusArea: string): Trial | null {
  const ps = study.protocolSection;
  if (!ps) return null;
  const nctId = ps.identificationModule?.nctId;
  if (!nctId) return null;
  const elig = ps.eligibilityModule ?? {};
  const criteriaText = (elig.eligibilityCriteria ?? "").trim();
  if (!criteriaText) return null;

  return {
    nctId,
    title: ps.identificationModule?.briefTitle ?? "",
    conditions: ps.conditionsModule?.conditions ?? [],
    conditionCodes: [],
    phase: normalizePhase(ps.designModule?.phases),
    sex: normalizeSex(elig.sex),
    minimumAge: parseAge(elig.minimumAge),
    maximumAge: parseAge(elig.maximumAge),
    healthyVolunteers: normalizeHealthyVolunteers(elig.healthyVolunteers),
    criteriaText,
    focusArea,
  };
}

async function fetchFocusArea(
  focusArea: string,
  skips: SkipRecord[],
): Promise<Trial[]> {
  const params = new URLSearchParams({
    "query.term": focusArea,
    "filter.overallStatus": "RECRUITING",
    "filter.advanced": "AREA[StudyType]INTERVENTIONAL",
    pageSize: String(PAGE_SIZE),
    fields: FIELDS,
    format: "json",
  });

  const url = `${API_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `ClinicalTrials.gov returned ${res.status} for "${focusArea}": ${body.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { studies?: StudyJson[] };
  const studies = json.studies ?? [];

  const trials: Trial[] = [];
  for (const study of studies) {
    const trial = extractTrial(study, focusArea);
    if (!trial) {
      const nctId =
        study.protocolSection?.identificationModule?.nctId ?? "<unknown>";
      skips.push({
        nctId,
        reason: "empty criteriaText or missing NCT id",
        focusArea,
      });
      continue;
    }
    trials.push(trial);
  }
  return trials;
}

async function main(): Promise<void> {
  const skips: SkipRecord[] = [];
  const byFocus = new Map<string, number>();
  const trialsById = new Map<string, Trial>();

  for (const focusArea of FOCUS_AREAS) {
    process.stdout.write(`Fetching "${focusArea}"... `);
    let fetched: Trial[];
    try {
      fetched = await fetchFocusArea(focusArea, skips);
    } catch (err) {
      console.error("\n  FAILED:", (err as Error).message);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    let newCount = 0;
    for (const t of fetched) {
      if (!trialsById.has(t.nctId)) {
        trialsById.set(t.nctId, t);
        newCount++;
      }
    }
    byFocus.set(focusArea, fetched.length);
    console.log(`${fetched.length} returned, ${newCount} new`);
    await sleep(REQUEST_DELAY_MS);
  }

  const trials = Array.from(trialsById.values());
  const outDir = join(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "trials.json");
  writeFileSync(outPath, JSON.stringify(trials, null, 2), "utf-8");

  console.log("\n=== Ingestion summary ===");
  console.log(`Total unique trials written: ${trials.length} → ${outPath}`);
  for (const [area, count] of byFocus) {
    console.log(`  ${area}: ${count}`);
  }
  if (skips.length > 0) {
    console.log(`\nSkipped (${skips.length}):`);
    for (const s of skips) {
      console.log(`  [${s.focusArea}] ${s.nctId}: ${s.reason}`);
    }
  } else {
    console.log("\nNo studies skipped.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
