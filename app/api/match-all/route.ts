import { evaluatePatientAgainstTrials } from "@/lib/multi-trial-engine";
import { filterTrialsForPatient, loadTrials } from "@/lib/trial-retrieval";
import type { FHIRBundle, Trial } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BUNDLE_ENTRIES = 3000;
const DEFAULT_MAX_TRIALS = 1;
const HARD_MAX_TRIALS = 20;

interface MatchAllRequestBody {
  bundle?: unknown;
  maxTrials?: unknown;
}

function isBundleShape(b: unknown): b is FHIRBundle {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  const obj = b as Record<string, unknown>;
  return obj.resourceType === "Bundle" && Array.isArray(obj.entry);
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: MatchAllRequestBody;
  try {
    body = (await request.json()) as MatchAllRequestBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  if (!isBundleShape(body.bundle)) {
    return jsonError(
      400,
      "Invalid FHIR bundle: must have resourceType 'Bundle' and an entry array",
    );
  }
  const bundle = body.bundle;

  if (bundle.entry.length > MAX_BUNDLE_ENTRIES) {
    return jsonError(
      413,
      `Bundle exceeds maximum size of ${MAX_BUNDLE_ENTRIES} entries`,
    );
  }

  let maxTrials = DEFAULT_MAX_TRIALS;
  if (body.maxTrials !== undefined) {
    if (
      typeof body.maxTrials !== "number" ||
      !Number.isInteger(body.maxTrials) ||
      body.maxTrials < 1
    ) {
      return jsonError(400, "maxTrials must be a positive integer");
    }
    if (body.maxTrials > HARD_MAX_TRIALS) {
      return jsonError(
        400,
        `maxTrials exceeds ${HARD_MAX_TRIALS}`,
      );
    }
    maxTrials = body.maxTrials;
  }

  let trials: Trial[];
  try {
    trials = loadTrials();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(500, `Failed to load trial corpus: ${msg}`);
  }

  const candidates = filterTrialsForPatient(bundle, trials);
  const eligible = candidates.filter((c) => !c.hardExcluded);
  const hardExcluded = candidates.filter((c) => c.hardExcluded);
  const topCandidates = eligible.slice(0, maxTrials);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        send("retrieval", {
          totalConsidered: candidates.length,
          hardExcluded,
          topCandidates,
        });

        const result = await evaluatePatientAgainstTrials(bundle, candidates, {
          maxTrials,
          onProgress: (done, total, currentNctId) => {
            const trial =
              topCandidates.find((c) => c.trial.nctId === currentNctId)?.trial;
            send("progress", {
              done,
              total,
              currentNctId,
              currentTitle: trial?.title ?? "",
            });
          },
          onTrialComplete: (evaluation) => {
            send("trial-complete", evaluation);
          },
        });

        send("done", result);
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[match-all] fatal:", err);
        send("error", { error: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}