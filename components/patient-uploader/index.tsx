"use client";

import { useRef, useState } from "react";

import type { FHIRBundle, Patient } from "@/lib/types";
import {
  getAge,
  getConditions,
  getMedicationRequests,
  getObservations,
  getPatient,
  getProcedures,
} from "@/lib/fhir-query";

interface Props {
  onBundleLoaded: (bundle: FHIRBundle) => void;
  currentBundle: FHIRBundle | null;
}

function formatPatientName(patient: Patient): string {
  const name = patient.name?.[0];
  if (!name) return "(unnamed)";
  const given = name.given?.join(" ") ?? "";
  const family = name.family ?? "";
  const full = `${given} ${family}`.trim();
  return full.length > 0 ? full : "(unnamed)";
}

export function PatientUploader({ onBundleLoaded, currentBundle }: Props) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFromText = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(
        `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { resourceType?: unknown }).resourceType !== "Bundle"
    ) {
      setError("File is not a FHIR Bundle (resourceType must be 'Bundle').");
      return;
    }
    if (!Array.isArray((parsed as { entry?: unknown }).entry)) {
      setError("Bundle is missing an 'entry' array.");
      return;
    }
    setError(null);
    onBundleLoaded(parsed as FHIRBundle);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => loadFromText(String(e.target?.result ?? ""));
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(file);
  };

  const loadSample = async () => {
    try {
      const res = await fetch("/sample-data/patient-bundle.json");
      if (!res.ok) {
        setError(`Failed to load sample patient: HTTP ${res.status}`);
        return;
      }
      loadFromText(await res.text());
    } catch (e) {
      setError(
        `Failed to load sample patient: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <section aria-label="Patient" className="rounded-md border border-gray-200 p-5">
      <h2 className="text-sm font-medium text-gray-700 mb-3">Patient</h2>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm px-3 py-1.5"
        >
          Upload bundle (.json)
        </button>
        <button
          type="button"
          onClick={loadSample}
          className="border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm px-3 py-1.5"
        >
          Use sample patient
        </button>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-sm text-red-800 px-3 py-2 mt-2">
          {error}
        </div>
      )}

      {currentBundle && <PatientSummary bundle={currentBundle} />}
    </section>
  );
}

function PatientSummary({ bundle }: { bundle: FHIRBundle }) {
  const patient = getPatient(bundle);
  if (!patient) {
    return (
      <div className="border border-amber-200 bg-amber-50 text-sm text-amber-800 px-3 py-2 mt-2">
        Bundle loaded but contains no Patient resource.
      </div>
    );
  }

  const age = getAge(bundle);
  const conditions = getConditions(bundle).length;
  const observations = getObservations(bundle).length;
  const medications = getMedicationRequests(bundle).length;
  const procedures = getProcedures(bundle).length;

  return (
    <div className="border border-gray-200 bg-gray-50 px-4 py-3 text-sm mt-3">
      <div className="font-medium text-gray-900">{formatPatientName(patient)}</div>
      <div className="text-gray-600 mt-0.5">
        {age !== null ? `${age} y/o` : "age unknown"}
        {" · "}
        {patient.gender ?? "unknown gender"}
        {patient.birthDate ? ` · born ${patient.birthDate}` : ""}
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-3 text-xs">
        <Stat label="Conditions" value={conditions} />
        <Stat label="Observations" value={observations} />
        <Stat label="Medications" value={medications} />
        <Stat label="Procedures" value={procedures} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-gray-900 font-mono text-base mt-0.5">{value}</dd>
    </div>
  );
}
