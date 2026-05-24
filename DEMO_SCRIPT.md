# Demo video script — 90 seconds

Target platform: LinkedIn. Voiceover over screen recording. Direct, technical, no narration filler.

---

## (0:00 – 0:05) — Hook

> Matching a patient to a clinical trial is a manual chart review. This does it in one POST.

[Screen: app/page.tsx loaded, blank state.]

---

## (0:05 – 1:05) — Demo

### (0:05 – 0:15) — Load patient

> The input is a FHIR Bundle — the standard format every modern EHR exports. Here's a sample patient: 55-year-old male, type 2 diabetes, HbA1c 7.2, on metformin, colonoscopy two years ago.

[Click "Use sample patient". The patient summary card renders: name, age 55, gender, 2 conditions / 1 observation / 1 medication / 1 procedure.]

### (0:15 – 0:25) — Load criteria

> On the right, paste the trial's eligibility text — copy-pasted from ClinicalTrials.gov. No structured format, no machine-readable schema. Just the bullet list.

[Click "Use sample criteria". Textarea fills with 6 inclusion + 7 exclusion criteria.]

### (0:25 – 0:35) — Run

> Click evaluate. Under the hood: Claude parses the criteria into structured rules, the engine pulls candidate FHIR resources for each rule, and Claude grades each criterion against just its relevant evidence.

[Click "Evaluate eligibility". Spinner shows. Wait ~30s.]

### (0:35 – 1:05) — Walk the verdict

> Eligible. Banner explains why: meets 5 of 6 inclusion criteria, no exclusions hit, one data gap.

[Point at banner.]

> Inclusion criteria — age 45 to 75. Met. Patient is 55. The "Evidence" disclosure shows the cited FHIR resource — `Patient/patient-001`, birthDate 1971-03-15. Every claim is grounded.

[Expand Evidence on the age criterion.]

> Exclusion — history of MI within 12 months. Not met, meaning the patient does NOT have it. The engine searched Conditions and found nothing. That's the right exclusion direction.

[Expand Evidence on the MI exclusion — shows the conditions it checked.]

> One gap: eGFR. The trial wants eGFR ≥ 45, and the bundle has no eGFR Observation. Needs more data. The system doesn't guess.

[Scroll to gap card.]

---

## (1:05 – 1:20) — Architecture call-out

> FHIR query is deterministic TypeScript — no LLM. Claude only handles the two ambiguous parts: parsing freeform criteria text into structured rules, and grading each rule against its evidence. The aggregator that decides the final verdict is pure code, fully unit-tested. 90+ tests cover the seams.

[Cut to a brief view of the repo structure or test output.]

---

## (1:20 – 1:30) — Close

> Code's on GitHub: github.com/Jeppy22/trial-eligibility-matcher. Next: real Synthea bundles, parallel evaluation, structured trial intake from the ClinicalTrials.gov API.

[End card with repo URL.]

---

## Recording notes

- Use the sample data both clicks — don't type. Faster, cleaner, no PII concerns.
- Screen at 1080p, browser zoomed to 110% so text reads on mobile playback.
- No mouse movement during voiceover paragraphs — move, pause, talk.
- Cut the 30-second loading wait down to 3 seconds with a speed ramp; show the spinner briefly so viewers know it's real latency.
- Audio: VO over silence. No music. Healthcare audience does not want a soundtrack.
