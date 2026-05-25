"use client";

import { useEffect, useState } from "react";

import type { FHIRBundle, PatientSummary } from "@/lib/types";

interface Props {
  onSelect: (bundle: FHIRBundle, summary: PatientSummary) => void;
  currentId: string | null;
}

export function PatientSelector({ onSelect, currentId }: Props) {
  const [summaries, setSummaries] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/sample-patients/manifest.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PatientSummary[];
        if (!cancelled) setSummaries(data);
      } catch (e) {
        if (!cancelled) {
          setError(
            `Failed to load patient list: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (id: string) => {
    if (!id || !summaries) return;
    const summary = summaries.find((s) => s.id === id);
    if (!summary) return;
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/sample-patients/${id}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bundle = (await res.json()) as FHIRBundle;
      onSelect(bundle, summary);
    } catch (e) {
      setError(
        `Failed to load patient: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section
      aria-label="Sample patient"
      className="rounded-md border border-gray-200 p-5"
    >
      <h2 className="text-sm font-medium text-gray-700 mb-3">Pick a patient</h2>

      {!summaries && !error && (
        <div className="text-sm text-gray-500">Loading patient list…</div>
      )}

      {summaries && (
        <select
          value={currentId ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          disabled={loadingId !== null}
          className="w-full border border-gray-300 bg-white text-sm px-3 py-2 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
        >
          <option value="">— Select a sample patient —</option>
          {summaries.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}, {s.age} {s.gender}, {s.conditionCount} conditions
            </option>
          ))}
        </select>
      )}

      {loadingId && (
        <div className="text-xs text-gray-500 mt-2">Loading bundle…</div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 text-sm text-red-800 px-3 py-2 mt-2">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500 mt-3">
        Patients are 10 synthetic Synthea bundles shipped with the app.
        Or upload your own below.
      </p>
    </section>
  );
}
