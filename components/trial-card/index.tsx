"use client";

import { useState } from "react";

import { EligibilityReport } from "@/components/eligibility-report";
import type { TrialEvaluation } from "@/lib/types";

interface Props {
  evaluation: TrialEvaluation;
  defaultExpanded?: boolean;
}

const PHASE_COLORS: Record<string, string> = {
  PHASE1: "bg-purple-100 text-purple-800",
  PHASE2: "bg-indigo-100 text-indigo-800",
  PHASE3: "bg-blue-100 text-blue-800",
  PHASE4: "bg-teal-100 text-teal-800",
  EARLY_PHASE1: "bg-purple-50 text-purple-700",
  NA: "bg-gray-100 text-gray-700",
};

function summarizeVerdict(evaluation: TrialEvaluation): string {
  if (evaluation.error) return `Error: ${evaluation.error}`;
  const v = evaluation.verdict;
  if (!v) return "No verdict";

  const inclusions = v.criteria_results.filter(
    (r) => r.criterion.type === "inclusion",
  );
  const exclusions = v.criteria_results.filter(
    (r) => r.criterion.type === "exclusion",
  );
  const inclusionsMet = inclusions.filter((r) => r.status === "met").length;
  const exclusionsHit = exclusions.filter((r) => r.status === "met").length;

  if (v.verdict === "INELIGIBLE") {
    const failing = v.criteria_results.find(
      (r) =>
        (r.criterion.type === "inclusion" && r.status === "not_met") ||
        (r.criterion.type === "exclusion" && r.status === "met"),
    );
    if (failing) {
      return `Excluded by ${failing.criterion.id}: ${failing.criterion.text.slice(0, 90)}${failing.criterion.text.length > 90 ? "…" : ""}`;
    }
    return `Ineligible · ${inclusionsMet}/${inclusions.length} inclusions met`;
  }

  if (v.verdict === "NEEDS_MORE_DATA") {
    return `${v.gaps.length} data gap${v.gaps.length === 1 ? "" : "s"} · ${inclusionsMet}/${inclusions.length} inclusions met`;
  }

  return `Met ${inclusionsMet}/${inclusions.length} inclusions, ${exclusionsHit} exclusion${exclusionsHit === 1 ? "" : "s"} hit`;
}

export function TrialCard({ evaluation, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { trial } = evaluation;

  const phaseClass = PHASE_COLORS[trial.phase] ?? "bg-gray-100 text-gray-700";

  return (
    <article className="border border-gray-200 rounded-md bg-white">
      <header className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-gray-900 leading-snug">
              {trial.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <a
                href={`https://clinicaltrials.gov/study/${trial.nctId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
              >
                {trial.nctId}
              </a>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm ${phaseClass}`}
              >
                {trial.phase}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-gray-50 text-gray-600 border border-gray-200">
                {trial.focusArea}
              </span>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-700 mt-2 leading-relaxed">
          {summarizeVerdict(evaluation)}
        </p>
      </header>

      {evaluation.verdict && (
        <div className="px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {expanded ? "Hide reasoning" : "Show reasoning"}
          </button>
          {expanded && (
            <div className="mt-3 -mx-4 px-4 pt-3 border-t border-gray-100">
              <EligibilityReport verdict={evaluation.verdict} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
