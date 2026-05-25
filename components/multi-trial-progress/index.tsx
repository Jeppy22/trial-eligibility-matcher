"use client";

interface RetrievalInfo {
  totalConsidered: number;
  hardExcluded: { trial: { nctId: string; title: string }; exclusionReason?: string }[];
  topCandidates: { trial: { nctId: string; title: string } }[];
}

interface ProgressInfo {
  done: number;
  total: number;
  currentTitle: string;
}

interface Props {
  retrieval: RetrievalInfo | null;
  progress: ProgressInfo | null;
}

export function MultiTrialProgress({ retrieval, progress }: Props) {
  if (!retrieval) {
    return (
      <div className="mt-6 border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
        Connecting…
      </div>
    );
  }

  const pct = progress
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0;
  const showProgress = progress !== null && progress.total > 0;

  return (
    <div className="mt-6 border border-blue-200 bg-blue-50/40 px-5 py-4 space-y-3">
      <div className="text-sm text-gray-800">
        <span className="font-medium">{retrieval.totalConsidered}</span> trials
        in corpus ·{" "}
        <span className="font-medium">{retrieval.hardExcluded.length}</span>{" "}
        hard-excluded (sex/age) ·{" "}
        <span className="font-medium">{retrieval.topCandidates.length}</span>{" "}
        candidates being evaluated
      </div>

      {showProgress && (
        <>
          <div className="h-2 bg-blue-100 rounded-sm overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-gray-700 tabular-nums">
            Evaluating trial {progress.done} of {progress.total}
            {progress.currentTitle ? ` — ${progress.currentTitle}` : ""}
          </div>
        </>
      )}
    </div>
  );
}
