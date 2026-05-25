# Clinical Trial Eligibility Matcher

Match a patient's FHIR Bundle against a clinical trial's eligibility criteria. POST a bundle and the criteria text and you get back an `ELIGIBLE` / `INELIGIBLE` / `NEEDS_MORE_DATA` verdict, with per-criterion reasoning and citations to the specific FHIR resources used.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind v4
- Anthropic SDK (`claude-sonnet-4-6-20250929`)
- vitest
- Deployed on Vercel

## Quickstart

```sh
git clone <repo>
cd trial-eligibility-matcher
npm install --legacy-peer-deps
cp .env.example .env.local
# Edit .env.local: ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

In another terminal:

```sh
npm run test:endpoint
```

You should see a `200` response with an `EligibilityVerdict` JSON body.

## Multi-trial matching (headline flow)

Pick (or upload) a patient, hit "Match against all trials," and the app:

1. **Retrieval** runs against `/data/trials.json` (89 trials from 5 focus areas) — a deterministic TypeScript scorer hard-excludes by sex/age and ranks the rest by condition-string overlap, phase, and healthy-volunteer flag. Costs nothing; takes a few ms.
2. **Evaluation** sends the top 10 candidates through the existing single-trial pipeline (parse criteria → grade per criterion with cited evidence), in parallel up to concurrency 3.
3. **Stream** Server-Sent Events back to the browser: a `retrieval` summary up front, a `trial-complete` event per finished trial, `progress` heartbeats, and a final `done` payload.

Results bucket into **Eligible**, **Needs more data**, **Ineligible**, and **Not assessed** (the hard-excluded set, surfaced for transparency).

### `POST /api/match-all`

Body: `{ "bundle": FHIRBundle, "maxTrials"?: number /* 1..20, default 10 */ }`. Returns `text/event-stream`.

### Cost and runtime

Per match-all run, with maxTrials=10, the LLM does **1 parse + N criteria calls** per trial — roughly 10–20 Sonnet 4.6 calls per trial. Realistic total: **$1.00–$2.00 and 60–150 seconds** depending on criteria density.

### Vercel plan caveat

`vercel.json` sets `maxDuration: 300` for `/api/match-all`, but **Vercel Hobby caps function execution at 10 seconds** — this endpoint will fail on Hobby. Use **Pro or higher** (300s) for the full multi-trial flow. The single-trial `/api/match` endpoint also fails on Hobby for typical criteria sets; see below.

## API contract

### `POST /api/match`

**Request:**

```json
{
  "bundle":       { "resourceType": "Bundle", "entry": [ ... ] },
  "criteriaText": "Inclusion Criteria:\n- Adults aged 45-75\n..."
}
```

**Response (200):**

```json
{
  "verdict": "ELIGIBLE",
  "criteria_results": [
    {
      "criterion": {
        "id": "C1",
        "text": "Adults aged 45 to 75 years.",
        "type": "inclusion",
        "requiredData": ["Patient"]
      },
      "status": "met",
      "reasoning": "Patient born 1971-03-15 is 55, within 45-75.",
      "evidence": [ /* cited FHIR resources */ ]
    }
  ],
  "gaps": []
}
```

`verdict` is one of `ELIGIBLE`, `INELIGIBLE`, `NEEDS_MORE_DATA`. `gaps` lists `[C<id>] <text>` strings for each criterion the engine could not decide.

**Errors:**

| Status | Cause |
|---|---|
| `400` | Invalid JSON body / invalid bundle shape / invalid `criteriaText` (missing, empty, or >10,000 chars) |
| `413` | `bundle.entry` exceeds 500 entries |
| `422` | No criteria could be parsed from the input text |
| `500` | Server misconfiguration (missing `ANTHROPIC_API_KEY`) or other internal error |
| `502` | Upstream LLM returned a response that failed validation |

**curl example:**

```sh
curl -X POST http://localhost:3000/api/match \
  -H "Content-Type: application/json" \
  -d "{\"bundle\": $(cat sample-data/patient-bundle.json), \"criteriaText\": $(jq -Rs . < sample-data/trial-criteria.txt)}"
```

## Sample data

- `sample-data/patient-bundle.json` — Synthea-shaped FHIR R4 bundle for a 55-year-old male with hypertension, type 2 diabetes, HbA1c 7.2%, active metformin, and a colonoscopy two years ago.
- `sample-data/trial-criteria.txt` — A T2DM / cardiovascular-prevention trial criteria block: 6 inclusion + 7 exclusion items in plain-text ClinicalTrials.gov format.

## Data Setup

Two one-time scripts populate the multi-trial corpus and the synthetic patient gallery. Neither is part of `npm run dev` — run them once after cloning, or whenever you want to refresh the data.

### Ingest trials

```sh
npx tsx scripts/ingest-trials.ts
```

Fetches up to 20 recruiting interventional studies from ClinicalTrials.gov v2 for each of 5 focus areas (T2DM, hypertension, CAD, breast cancer screening, CKD), deduplicates by NCT ID, and writes `/data/trials.json`. **The output file is committed** (`.gitignore` excludes `/data/*` except `trials.json`) so deploys ship with the corpus and the app does not hit the API at request time.

Polite to ClinicalTrials.gov: 500ms delay between requests, identifies itself in the User-Agent header.

### Generate patients

```sh
# default jar path: C:\dev\fhir-ai\synthea\synthea-with-dependencies.jar
npx tsx scripts/generate-patients.ts

# or override:
# PowerShell
$env:SYNTHEA_JAR_PATH = "D:\path\to\synthea-with-dependencies.jar"; npx tsx scripts/generate-patients.ts
# bash
SYNTHEA_JAR_PATH=/path/to/synthea-with-dependencies.jar npx tsx scripts/generate-patients.ts
```

Runs Synthea to generate 10 Massachusetts patients into `./synthea-output/` (gitignored), copies each patient's FHIR Bundle to `/public/sample-patients/{id}.json`, and writes `/public/sample-patients/manifest.json` summarizing each one (age, gender, condition count, top 3 active conditions). Both the per-patient bundles and the manifest are committed.

Requires Java on `PATH` and the Synthea fat jar (`synthea-with-dependencies.jar`) on disk.

## Tests

```sh
npm run test:run            # unit tests (LLM calls mocked)
```

Integration tests hit the real Anthropic API and are skipped by default. To run them:

```sh
# PowerShell
$env:RUN_INTEGRATION_TESTS = "1"; $env:ANTHROPIC_API_KEY = "sk-ant-..."; npm run test:run

# bash / zsh
RUN_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... npm run test:run
```

End-to-end smoke test against a running dev server:

```sh
npm run dev                 # in one terminal
npm run test:endpoint       # in another
```

## Architecture

```
criteriaText ─▶ parseCriteria ─▶ Criterion[] ─┐
                                              ├─▶ evaluateEligibility ─▶ aggregateVerdict ─▶ EligibilityVerdict
       bundle ─▶ gatherEvidence ─▶ FHIRResource[] ─┘
```

- **`lib/fhir-query/`** — Pure-TS extractors over a FHIRBundle. Patient, conditions, observations, medications, procedures + derived helpers (age, latest observation by code, etc). No LLM.
- **`lib/criteria-parser/`** — Plain-text criteria → structured `Criterion[]` via Claude. One LLM call per request.
- **`lib/eligibility-engine/`** — For each criterion: gather evidence, ask Claude `met` / `not_met` / `needs_more_data` with citations, then aggregate into an `EligibilityVerdict`. One LLM call per criterion, sequential.
- **`app/api/match/route.ts`** — Validates the request, runs the pipeline, returns the verdict.

## Deploy

The app is set up for Vercel.

1. Push to GitHub, import the repo in Vercel.
2. **Install Command**: set to `npm install --legacy-peer-deps` in **Project Settings → General → Build & Development Settings**. The Next 15 + React 19 RC peer-dep resolution fails on a plain `npm install`.
3. **Environment Variables** (Project Settings → Environment Variables):
   - `ANTHROPIC_API_KEY` — your Anthropic API key, scope: Production + Preview + Development.
4. Trigger a deploy. The repo includes `vercel.json` which raises the `/api/match` function timeout to 60 seconds.

> ⚠️ **Function-timeout caveat.** `vercel.json` requests `maxDuration: 60`, but **Vercel Hobby caps function execution at 10 seconds** regardless of the manifest. A full evaluation of the sample trial (~14 sequential LLM calls) takes 30–60s, so it will time out on Hobby. Use **Pro or higher** to get the full 60s. On Hobby, either upgrade or reduce the criteria count.

The sample data lives at `public/sample-data/` and is committed; `npm run sync-samples` re-copies from `sample-data/` to `public/sample-data/` if you edit the source files (Linux/macOS — the build environment Vercel runs in).

## Scope (V1)

**In:**

- Single trial per request
- Single patient bundle per request
- LLM evaluation per criterion (sequential, one API call each)
- Plain-text trial criteria (no machine-readable schema required)
- Stateless — every request stands alone

**Out:**

- User accounts / auth
- Persistence — no DB, no caching across requests
- Multi-trial matching / cohort ranking
- ML-driven scoring or evidence-strength weighting
- Real-PHI handling — the sample bundle is synthetic; do not POST production patient data to this endpoint as it currently stands
