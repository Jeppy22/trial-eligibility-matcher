"use client";

import type {
  EligibilityVerdict,
  FHIRResource,
  MatchResult,
  MatchStatus,
  Verdict,
} from "@/lib/types";

interface Props {
  verdict: EligibilityVerdict;
}

const VERDICT_STYLES: Record<
  Verdict,
  { bg: string; border: string; text: string; label: string }
> = {
  ELIGIBLE: {
    bg: "bg-green-50",
    border: "border-green-700",
    text: "text-green-800",
    label: "ELIGIBLE",
  },
  INELIGIBLE: {
    bg: "bg-red-50",
    border: "border-red-700",
    text: "text-red-800",
    label: "INELIGIBLE",
  },
  NEEDS_MORE_DATA: {
    bg: "bg-amber-50",
    border: "border-amber-600",
    text: "text-amber-800",
    label: "NEEDS MORE DATA",
  },
};

const STATUS_STYLES: Record<
  MatchStatus,
  { bg: string; text: string; label: string }
> = {
  met: { bg: "bg-green-100", text: "text-green-800", label: "met" },
  not_met: { bg: "bg-red-100", text: "text-red-800", label: "not met" },
  needs_more_data: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    label: "needs more data",
  },
};

const TYPE_STYLES = {
  inclusion: { bg: "bg-blue-50", text: "text-blue-700", label: "inclusion" },
  exclusion: { bg: "bg-gray-100", text: "text-gray-700", label: "exclusion" },
} as const;

export function EligibilityReport({ verdict }: Props) {
  const inclusions = verdict.criteria_results.filter(
    (r) => r.criterion.type === "inclusion",
  );
  const exclusions = verdict.criteria_results.filter(
    (r) => r.criterion.type === "exclusion",
  );
  const inclusionsMet = inclusions.filter((r) => r.status === "met").length;

  const v = VERDICT_STYLES[verdict.verdict];

  return (
    <div className="mt-10 space-y-6 max-w-3xl mx-auto">
      <div className={`border-l-4 ${v.border} ${v.bg} px-6 py-4`}>
        <div className={`text-2xl font-semibold tracking-tight ${v.text}`}>
          {v.label}
        </div>
        <p className="text-sm text-gray-700 mt-1">
          Patient meets {inclusionsMet} of {inclusions.length} inclusion criteria.{" "}
          {exclusions.length} exclusion criteria assessed. {verdict.gaps.length}{" "}
          data gap{verdict.gaps.length === 1 ? "" : "s"}.
        </p>
      </div>

      {verdict.gaps.length > 0 && (
        <section className="border-l-4 border-amber-600 bg-amber-50/60 px-5 py-4">
          <h3 className="text-sm font-medium text-amber-900 mb-2">
            Data gaps ({verdict.gaps.length})
          </h3>
          <ul className="space-y-1">
            {verdict.gaps.map((gap, i) => (
              <li key={i} className="text-sm text-amber-900">
                {gap}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          All criteria ({verdict.criteria_results.length})
        </h3>
        <div className="space-y-3">
          {verdict.criteria_results.map((r) => (
            <CriterionCard key={r.criterion.id} result={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CriterionCard({ result }: { result: MatchResult }) {
  const typeStyle = TYPE_STYLES[result.criterion.type];
  const statusStyle = STATUS_STYLES[result.status];

  return (
    <article className="border border-gray-200 rounded-md">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono border border-gray-300 px-1.5 py-0.5 text-gray-700">
            {result.criterion.id}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-sm ${typeStyle.bg} ${typeStyle.text}`}
          >
            {typeStyle.label}
          </span>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-sm ${statusStyle.bg} ${statusStyle.text}`}
        >
          {statusStyle.label}
        </span>
      </header>

      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-gray-900 leading-relaxed">
          {result.criterion.text}
        </p>

        <div className="border-l-2 border-gray-200 pl-3 text-sm text-gray-600 italic leading-relaxed">
          {result.reasoning}
        </div>

        {result.evidence.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:text-blue-800 select-none">
              Evidence ({result.evidence.length})
            </summary>
            <div className="mt-2 space-y-2">
              {result.evidence.map((r) => (
                <EvidenceItem key={`${r.resourceType}/${r.id}`} resource={r} />
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function EvidenceItem({ resource }: { resource: FHIRResource }) {
  return (
    <div className="border border-gray-200 bg-white px-3 py-2">
      <div className="text-xs font-mono text-gray-500">
        {resource.resourceType}/{resource.id}
      </div>
      <div className="text-sm text-gray-800 mt-1">
        {summarizeResource(resource)}
      </div>
      <details className="mt-2">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">
          show raw FHIR
        </summary>
        <pre className="mt-1 text-xs font-mono bg-gray-50 border border-gray-200 p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(resource, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function summarizeResource(r: FHIRResource): string {
  switch (r.resourceType) {
    case "Patient": {
      const name = r.name?.[0];
      const display = name
        ? `${name.given?.join(" ") ?? ""} ${name.family ?? ""}`.trim()
        : "(unnamed)";
      const dob = r.birthDate ? ` · born ${r.birthDate}` : "";
      return `${display || "(unnamed)"} · ${r.gender ?? "unknown gender"}${dob}`;
    }
    case "Condition": {
      const code = r.code?.text ?? r.code?.coding?.[0]?.display ?? "(no code text)";
      const status = r.clinicalStatus?.coding?.[0]?.code ?? "unknown status";
      const onset = r.onsetDateTime ? ` · onset ${r.onsetDateTime}` : "";
      return `${code} · ${status}${onset}`;
    }
    case "Observation": {
      const code = r.code?.text ?? r.code?.coding?.[0]?.display ?? "(no code text)";
      const value = r.valueQuantity
        ? `${r.valueQuantity.value}${r.valueQuantity.unit ? " " + r.valueQuantity.unit : ""}`
        : "no value";
      const when = r.effectiveDateTime ? ` · ${r.effectiveDateTime}` : "";
      return `${code} = ${value}${when}`;
    }
    case "MedicationRequest": {
      const med =
        r.medicationCodeableConcept?.text ??
        r.medicationCodeableConcept?.coding?.[0]?.display ??
        "(no med text)";
      return `${med} · ${r.status}`;
    }
    case "Procedure": {
      const code = r.code?.text ?? r.code?.coding?.[0]?.display ?? "(no code text)";
      const when = r.performedDateTime ? ` · performed ${r.performedDateTime}` : "";
      return `${code} · ${r.status}${when}`;
    }
  }
}
