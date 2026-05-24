"use client";

import { useState } from "react";

import { CriteriaInput } from "@/components/criteria-input";
import { EligibilityReport } from "@/components/eligibility-report";
import { PatientUploader } from "@/components/patient-uploader";
import type { EligibilityVerdict, FHIRBundle } from "@/lib/types";

export default function Home() {
  const [bundle, setBundle] = useState<FHIRBundle | null>(null);
  const [criteriaText, setCriteriaText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EligibilityVerdict | null>(null);

  const canSubmit =
    bundle !== null && criteriaText.trim().length > 0 && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, criteriaText }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = body?.error ?? `HTTP ${res.status}`;
        const detail = body?.detail ? ` — ${body.detail}` : "";
        setError(`${msg}${detail}`);
      } else {
        setResult(body as EligibilityVerdict);
      }
    } catch (e) {
      setError(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Clinical Trial Eligibility Matcher
          </h1>
          <p className="text-sm text-gray-600 mt-2 max-w-2xl">
            Upload a patient FHIR Bundle and trial eligibility criteria. Returns
            a verdict with per-criterion reasoning and citations to the FHIR
            resources used.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <PatientUploader
            currentBundle={bundle}
            onBundleLoaded={setBundle}
          />
          <CriteriaInput value={criteriaText} onChange={setCriteriaText} />
        </div>

        <div className="mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
          >
            {loading ? (
              <>
                <Spinner />
                Evaluating... this may take 30–60 seconds
              </>
            ) : (
              "Evaluate eligibility"
            )}
          </button>
          {!loading && !bundle && (
            <span className="text-xs text-gray-500">Load a patient bundle to begin.</span>
          )}
          {!loading && bundle && criteriaText.trim().length === 0 && (
            <span className="text-xs text-gray-500">Add trial criteria to begin.</span>
          )}
        </div>

        {error && (
          <div className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="font-medium mb-0.5">Error</div>
            <div className="break-words">{error}</div>
          </div>
        )}

        {result && <EligibilityReport verdict={result} />}
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

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="4"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
