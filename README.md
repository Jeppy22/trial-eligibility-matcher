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
