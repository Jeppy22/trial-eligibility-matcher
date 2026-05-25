import trials from "@/data/trials.json";
import { MatchWorkspace } from "@/components/match-workspace";

const FOCUS_AREAS = [
  "Type 2 diabetes mellitus",
  "Hypertension",
  "Coronary artery disease",
  "Breast cancer screening",
  "Chronic kidney disease",
];

export default function Home() {
  const trialCount = Array.isArray(trials) ? trials.length : 0;

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Clinical Trial Eligibility Matcher
          </h1>
          <p className="text-sm text-gray-600 mt-2 max-w-2xl">
            Match a FHIR patient bundle against a corpus of recruiting
            ClinicalTrials.gov trials. Retrieval narrows the field; Claude
            grades each remaining trial criterion-by-criterion with cited
            evidence.
          </p>
        </header>

        <MatchWorkspace trialCount={trialCount} focusAreas={FOCUS_AREAS} />
      </div>

      <footer className="border-t border-gray-200 mt-16 py-5">
        <div className="max-w-5xl mx-auto px-6 text-xs text-gray-500">
          Built by Jeff Madden ·{" "}
          <a
            href="https://github.com/Jeppy22/trial-eligibility-matcher"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
          >
            github.com/Jeppy22/trial-eligibility-matcher
          </a>
        </div>
      </footer>
    </main>
  );
}
