"use client";

import { useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const MAX = 10_000;
const AMBER_AT = 8_000;
const RED_AT = 9_500;

export function CriteriaInput({ value, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);

  const loadSample = async () => {
    try {
      const res = await fetch("/sample-data/trial-criteria.txt");
      if (!res.ok) {
        setError(`Failed to load sample criteria: HTTP ${res.status}`);
        return;
      }
      setError(null);
      onChange(await res.text());
    } catch (e) {
      setError(
        `Failed to load sample criteria: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const len = value.length;
  const counterClass =
    len >= RED_AT
      ? "text-red-700"
      : len >= AMBER_AT
      ? "text-amber-600"
      : "text-gray-500";

  return (
    <section aria-label="Criteria" className="rounded-md border border-gray-200 p-5">
      <h2 className="text-sm font-medium text-gray-700 mb-3">Trial criteria</h2>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={loadSample}
          className="border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm px-3 py-1.5"
        >
          Use sample criteria
        </button>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-sm text-red-800 px-3 py-2 mb-2">
          {error}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        spellCheck={false}
        placeholder={"Paste trial criteria here. Example:\n\nInclusion Criteria:\n- Adults aged 45-75\n- Type 2 diabetes for at least 6 months\n\nExclusion Criteria:\n- History of MI within 12 months\n- eGFR < 45 mL/min/1.73m^2"}
        className="w-full font-mono text-sm border border-gray-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none px-3 py-2 resize-y leading-relaxed"
      />

      <div className={`text-xs mt-1 tabular-nums ${counterClass}`}>
        {len.toLocaleString()} / {MAX.toLocaleString()} characters
      </div>
    </section>
  );
}
