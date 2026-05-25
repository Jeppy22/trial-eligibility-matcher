# Demo video script — 90 seconds

Target platform: LinkedIn. Voiceover over screen recording. Direct, technical, no narration filler.

---

## (0:00 – 0:05) — Hook

> Patients miss clinical trials they qualify for because matching is manual. Here's the same patient against 89 real trials in under two minutes.

[Screen: app/page.tsx loaded, blank "All trials" tab default.]

---

## (0:05 – 1:10) — Demo

### (0:05 – 0:15) — Pick a patient

> The dropdown is ten synthetic Synthea patients shipped with the app. Pick one — 59-year-old female, 40 conditions, real FHIR bundle. The corpus on the right: 89 recruiting trials I pulled from the ClinicalTrials.gov API, across five focus areas — diabetes, hypertension, CAD, breast cancer screening, CKD.

[Click the dropdown, pick "Jinny S., 59 female, 40 conditions". Patient summary card renders below.]

### (0:15 – 0:25) — Kick off matching

> Click "Match against all trials." First thing the app does is a cheap deterministic retrieval pass — pure TypeScript, no LLM. Hard-excludes trials by sex and age, ranks the rest by condition overlap.

[Click "Match against all trials". The progress card appears.]

> "89 trials in corpus, 12 hard-excluded for sex or age, 10 candidates being evaluated." That's the narrowing. Now Claude grades each of those 10 trials criterion-by-criterion, three in parallel.

### (0:25 – 1:00) — Watch trials complete in real time

> The endpoint streams Server-Sent Events. Each trial card pops in as soon as it finishes — eligible, ineligible, or needs more data. You can read the verdicts as they land.

[Show trial cards appearing one by one. Progress bar advances "Evaluating 3 of 10", "5 of 10".]

[Wait for completion — speed-ramp in post if longer than ~30s. ~$1–2 in API spend per run.]

> Done. Three eligible matches, four need more data, two ineligible, one not assessed.

### (1:00 – 1:10) — Expand an eligible match

> Open the top eligible match. Same criterion-level reasoning as the single-trial flow — every claim has a citation to the specific FHIR resource the engine used. Patient is 59, the trial wants 18–75, here's the Patient resource the engine cited.

[Expand "Show reasoning" on the top card. Scroll through the criteria cards, expand one Evidence disclosure.]

---

## (1:10 – 1:25) — Architecture call-out

> Two layers of deterministic code wrap one layer of LLM. Retrieval is pure TypeScript — no LLM, no surprises, instant. FHIR query is pure TypeScript — no LLM, fully unit-tested. Claude only does the two genuinely ambiguous jobs: parsing freeform criteria text into rules, and grading each rule against its cited evidence. 120+ tests cover the seams.

[Cut to a brief view of the repo structure or test output.]

---

## (1:25 – 1:30) — Close

> Code's on GitHub: github.com/Jeppy22/trial-eligibility-matcher.

[End card with repo URL.]

---

## Recording notes

- Use the dropdown both clicks — don't type. Faster, cleaner, no PII concerns.
- Screen at 1080p, browser zoomed to 110% so text reads on mobile playback.
- No mouse movement during voiceover paragraphs — move, pause, talk.
- The ~60–150s evaluation wait will need a speed ramp. Keep the first ~5s of streaming real so viewers see the cards landing, then ramp through.
- Audio: VO over silence. No music. Healthcare audience does not want a soundtrack.
- Toggle to "Single trial" at the very end if there's time, just to show it's still there. Otherwise skip.
