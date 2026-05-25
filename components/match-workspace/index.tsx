"use client";

import { useState } from "react";

import { CriteriaInput } from "@/components/criteria-input";
import { EligibilityReport } from "@/components/eligibility-report";
import { MultiTrialProgress } from "@/components/multi-trial-progress";
import { PatientSelector } from "@/components/patient-selector";
import { PatientUploader } from "@/components/patient-uploader";
import { TrialCard } from "@/components/trial-card";
import type {
  EligibilityVerdict,
  FHIRBundle,
  MultiTrialResult,
  RetrievalResult,
  TrialEvaluation,
} from "@/lib/types";

type Mode = "all" | "single";

interface RetrievalInfo {
  totalConsidered: number;
  hardExcluded: RetrievalResult[];
  topCandidates: RetrievalResult[];
}

interface ProgressInfo {
  done: number;
  total: number;
  currentNctId: string;
  currentTitle: string;
}

interface Props {
  trialCount: number;
  focusAreas: string[];
}

export function MatchWorkspace({ trialCount, focusAreas }: Props) {
  const [mode, setMode] = useState<Mode>("all");

  // Shared state
  const [bundle, setBundle] = useState<FHIRBundle | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);

  // Single-trial state
  const [criteriaText, setCriteriaText] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<EligibilityVerdict | null>(
    null,
  );

  // Multi-trial state
  const [streaming, setStreaming] = useState(false);
  const [retrieval, setRetrieval] = useState<RetrievalInfo | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [liveEvaluations, setLiveEvaluations] = useState<TrialEvaluation[]>([]);
  const [multiError, setMultiError] = useState<string | null>(null);
  const [multiResult, setMultiResult] = useState<MultiTrialResult | null>(null);

  const onPatientUploaded = (b: FHIRBundle) => {
    setBundle(b);
    setPatientId(null);
  };
  const onPatientPicked = (b: FHIRBundle, id: string) => {
    setBundle(b);
    setPatientId(id);
  };

  const handleSingleSubmit = async () => {
    if (!bundle || criteriaText.trim().length === 0) return;
    setSingleLoading(true);
    setSingleError(null);
    setSingleResult(null);
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
        setSingleError(`${msg}${detail}`);
      } else {
        setSingleResult(body as EligibilityVerdict);
      }
    } catch (e) {
      setSingleError(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSingleLoading(false);
    }
  };

  const handleMatchAll = async () => {
    if (!bundle) return;
    setStreaming(true);
    setMultiError(null);
    setRetrieval(null);
    setProgress(null);
    setLiveEvaluations([]);
    setMultiResult(null);

    try {
      const res = await fetch("/api/match-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        setMultiError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (event === "retrieval") {
            setRetrieval(parsed as RetrievalInfo);
          } else if (event === "progress") {
            setProgress(parsed as ProgressInfo);
          } else if (event === "trial-complete") {
            setLiveEvaluations((prev) => [
              ...prev,
              parsed as TrialEvaluation,
            ]);
          } else if (event === "done") {
            setMultiResult(parsed as MultiTrialResult);
          } else if (event === "error") {
            setMultiError(
              (parsed as { error: string }).error ?? "Unknown stream error",
            );
          }
        }
      }
    } catch (e) {
      setMultiError(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setStreaming(false);
    }
  };

  return (
    <>
      <ModeToggle mode={mode} onChange={setMode} />

      {mode === "all" ? (
        <AllTrialsMode
          trialCount={trialCount}
          focusAreas={focusAreas}
          bundle={bundle}
          patientId={patientId}
          onPatientUploaded={onPatientUploaded}
          onPatientPicked={onPatientPicked}
          streaming={streaming}
          retrieval={retrieval}
          progress={progress}
          liveEvaluations={liveEvaluations}
          multiResult={multiResult}
          multiError={multiError}
          onMatchAll={handleMatchAll}
        />
      ) : (
        <SingleTrialMode
          bundle={bundle}
          onPatientUploaded={onPatientUploaded}
          criteriaText={criteriaText}
          onCriteriaChange={setCriteriaText}
          loading={singleLoading}
          error={singleError}
          result={singleResult}
          onSubmit={handleSingleSubmit}
        />
      )}
    </>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Matching mode"
      className="inline-flex border border-gray-300 rounded-md overflow-hidden mb-6"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "all"}
        onClick={() => onChange("all")}
        className={`px-4 py-1.5 text-sm font-medium ${
          mode === "all"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        All trials
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "single"}
        onClick={() => onChange("single")}
        className={`px-4 py-1.5 text-sm font-medium border-l border-gray-300 ${
          mode === "single"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        Single trial
      </button>
    </div>
  );
}

function CorpusInfoCard({
  trialCount,
  focusAreas,
}: {
  trialCount: number;
  focusAreas: string[];
}) {
  return (
    <section
      aria-label="Trial corpus"
      className="rounded-md border border-gray-200 p-5 bg-gray-50"
    >
      <h2 className="text-sm font-medium text-gray-700 mb-1">Trial corpus</h2>
      <p className="text-sm text-gray-700 leading-relaxed">
        Evaluating against{" "}
        <span className="font-medium">{trialCount}</span> recruiting
        ClinicalTrials.gov trials across {focusAreas.length} focus areas.
      </p>
      <ul className="mt-2 text-xs text-gray-600 list-disc pl-5 space-y-0.5">
        {focusAreas.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  );
}

function AllTrialsMode(props: {
  trialCount: number;
  focusAreas: string[];
  bundle: FHIRBundle | null;
  patientId: string | null;
  onPatientUploaded: (b: FHIRBundle) => void;
  onPatientPicked: (b: FHIRBundle, id: string) => void;
  streaming: boolean;
  retrieval: RetrievalInfo | null;
  progress: ProgressInfo | null;
  liveEvaluations: TrialEvaluation[];
  multiResult: MultiTrialResult | null;
  multiError: string | null;
  onMatchAll: () => void;
}) {
  const {
    trialCount,
    focusAreas,
    bundle,
    patientId,
    onPatientUploaded,
    onPatientPicked,
    streaming,
    retrieval,
    progress,
    liveEvaluations,
    multiResult,
    multiError,
    onMatchAll,
  } = props;

  const canSubmit = bundle !== null && !streaming;
  // Once `done` arrives, multiResult.evaluations is the source of truth.
  // Until then, liveEvaluations accumulates from trial-complete events.
  const evaluations = multiResult?.evaluations ?? liveEvaluations;
  const allDone =
    multiResult !== null &&
    (!progress || progress.done === progress.total);

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <PatientSelector
          currentId={patientId}
          onSelect={(b, summary) => onPatientPicked(b, summary.id)}
        />
        <CorpusInfoCard trialCount={trialCount} focusAreas={focusAreas} />
      </div>

      <div className="mt-6">
        <PatientUploader
          currentBundle={bundle}
          onBundleLoaded={onPatientUploaded}
        />
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={onMatchAll}
          disabled={!canSubmit}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
        >
          {streaming ? (
            <>
              <Spinner />
              Matching against {trialCount} trials…
            </>
          ) : (
            "Match against all trials"
          )}
        </button>
        {!streaming && !bundle && (
          <span className="text-xs text-gray-500">
            Pick or upload a patient to begin.
          </span>
        )}
      </div>

      {multiError && (
        <div className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium mb-0.5">Error</div>
          <div className="break-words">{multiError}</div>
        </div>
      )}

      {(streaming || retrieval) && !allDone && (
        <MultiTrialProgress retrieval={retrieval} progress={progress} />
      )}

      {(evaluations.length > 0 || multiResult) && (
        <MultiTrialResults
          evaluations={evaluations}
          hardExcluded={
            multiResult?.hardExcluded ?? retrieval?.hardExcluded ?? []
          }
          summary={multiResult?.summary ?? null}
          durationMs={multiResult?.totalDurationMs ?? null}
        />
      )}
    </>
  );
}

function MultiTrialResults({
  evaluations,
  hardExcluded,
  summary,
  durationMs,
}: {
  evaluations: TrialEvaluation[];
  hardExcluded: RetrievalResult[];
  summary: MultiTrialResult["summary"] | null;
  durationMs: number | null;
}) {
  const eligible = evaluations.filter(
    (e) => e.verdict?.verdict === "ELIGIBLE",
  );
  const needsMore = evaluations.filter(
    (e) => e.verdict?.verdict === "NEEDS_MORE_DATA",
  );
  const ineligible = evaluations.filter(
    (e) => e.verdict?.verdict === "INELIGIBLE",
  );
  const errored = evaluations.filter((e) => e.error || !e.verdict);

  return (
    <div className="mt-8 space-y-4">
      {summary && (
        <div className="text-sm text-gray-700">
          Evaluated {summary.evaluated} of {summary.totalConsidered} trials
          {durationMs !== null
            ? ` in ${Math.round(durationMs / 100) / 10}s`
            : ""}
          . {summary.eligible} eligible · {summary.needsMoreData} needs more
          data · {summary.ineligible} ineligible · {summary.hardExcluded} not
          assessed.
        </div>
      )}

      <Bucket
        title="Eligible"
        count={eligible.length}
        tone="green"
        defaultOpen
      >
        {eligible.length === 0 ? (
          <Empty>No eligible matches.</Empty>
        ) : (
          eligible.map((e) => (
            <TrialCard
              key={e.trial.nctId}
              evaluation={e}
              defaultExpanded={false}
            />
          ))
        )}
      </Bucket>

      <Bucket
        title="Needs more data"
        count={needsMore.length}
        tone="amber"
        defaultOpen={eligible.length === 0}
      >
        {needsMore.length === 0 ? (
          <Empty>No gaps found.</Empty>
        ) : (
          needsMore.map((e) => (
            <TrialCard key={e.trial.nctId} evaluation={e} />
          ))
        )}
      </Bucket>

      <Bucket title="Ineligible" count={ineligible.length} tone="red">
        {ineligible.length === 0 ? (
          <Empty>No ineligible matches.</Empty>
        ) : (
          ineligible.map((e) => (
            <TrialCard key={e.trial.nctId} evaluation={e} />
          ))
        )}
      </Bucket>

      {errored.length > 0 && (
        <Bucket title="Errored" count={errored.length} tone="gray">
          {errored.map((e) => (
            <TrialCard key={e.trial.nctId} evaluation={e} />
          ))}
        </Bucket>
      )}

      {hardExcluded.length > 0 && (
        <Bucket
          title="Not assessed (sex/age mismatch)"
          count={hardExcluded.length}
          tone="gray"
        >
          {hardExcluded.map((r) => (
            <article
              key={r.trial.nctId}
              className="border border-gray-200 rounded-md bg-white px-4 py-3"
            >
              <h3 className="text-sm font-medium text-gray-900">
                {r.trial.title}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <a
                  href={`https://clinicaltrials.gov/study/${r.trial.nctId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-blue-600 hover:text-blue-800 underline-offset-2 hover:underline"
                >
                  {r.trial.nctId}
                </a>
                <span className="text-xs text-gray-500">
                  {r.exclusionReason}
                </span>
              </div>
            </article>
          ))}
        </Bucket>
      )}
    </div>
  );
}

const TONE_STYLES = {
  green: { border: "border-green-300", bg: "bg-green-50", text: "text-green-800" },
  amber: { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-800" },
  red: { border: "border-red-300", bg: "bg-red-50", text: "text-red-800" },
  gray: { border: "border-gray-300", bg: "bg-gray-50", text: "text-gray-700" },
} as const;

function Bucket({
  title,
  count,
  tone,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  tone: keyof typeof TONE_STYLES;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const t = TONE_STYLES[tone];
  return (
    <details
      open={defaultOpen}
      className={`border ${t.border} rounded-md overflow-hidden`}
    >
      <summary
        className={`cursor-pointer select-none px-4 py-2.5 text-sm font-medium ${t.bg} ${t.text} flex items-center justify-between`}
      >
        <span>{title}</span>
        <span className="font-mono text-xs tabular-nums">{count}</span>
      </summary>
      <div className="p-3 space-y-3 bg-white">{children}</div>
    </details>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-500 px-1 py-2">{children}</div>;
}

function SingleTrialMode(props: {
  bundle: FHIRBundle | null;
  onPatientUploaded: (b: FHIRBundle) => void;
  criteriaText: string;
  onCriteriaChange: (s: string) => void;
  loading: boolean;
  error: string | null;
  result: EligibilityVerdict | null;
  onSubmit: () => void;
}) {
  const {
    bundle,
    onPatientUploaded,
    criteriaText,
    onCriteriaChange,
    loading,
    error,
    result,
    onSubmit,
  } = props;
  const canSubmit =
    bundle !== null && criteriaText.trim().length > 0 && !loading;

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <PatientUploader
          currentBundle={bundle}
          onBundleLoaded={onPatientUploaded}
        />
        <CriteriaInput value={criteriaText} onChange={onCriteriaChange} />
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2"
        >
          {loading ? (
            <>
              <Spinner />
              Evaluating… this may take 30–60 seconds
            </>
          ) : (
            "Evaluate eligibility"
          )}
        </button>
        {!loading && !bundle && (
          <span className="text-xs text-gray-500">
            Load a patient bundle to begin.
          </span>
        )}
        {!loading && bundle && criteriaText.trim().length === 0 && (
          <span className="text-xs text-gray-500">
            Add trial criteria to begin.
          </span>
        )}
      </div>

      {error && (
        <div className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium mb-0.5">Error</div>
          <div className="break-words">{error}</div>
        </div>
      )}

      {result && <EligibilityReport verdict={result} />}
    </>
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
