import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EligibilityVerdict,
  FHIRBundle,
  RetrievalResult,
  Trial,
  TrialEvaluation,
} from "@/lib/types";

const {
  mockLoadTrials,
  mockFilter,
  mockEvaluate,
} = vi.hoisted(() => ({
  mockLoadTrials: vi.fn(),
  mockFilter: vi.fn(),
  mockEvaluate: vi.fn(),
}));

vi.mock("@/lib/trial-retrieval", () => ({
  loadTrials: mockLoadTrials,
  filterTrialsForPatient: mockFilter,
  // top is unused by the route but exported by the module — provide a noop.
  top: vi.fn(),
}));

vi.mock("@/lib/multi-trial-engine", () => ({
  evaluatePatientAgainstTrials: mockEvaluate,
}));

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/match-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyStr,
  });
}

const validBundle: FHIRBundle = {
  resourceType: "Bundle",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "p1",
        gender: "male",
        birthDate: "1985-01-01",
      },
    },
  ],
};

function makeTrial(nctId: string, title: string): Trial {
  return {
    nctId,
    title,
    conditions: [],
    conditionCodes: [],
    phase: "PHASE2",
    sex: "ALL",
    minimumAge: null,
    maximumAge: null,
    healthyVolunteers: false,
    criteriaText: "Inclusion: adult.",
    focusArea: "test",
  };
}

function makeCandidate(
  trial: Trial,
  hardExcluded = false,
  exclusionReason?: string,
): RetrievalResult {
  return {
    trial,
    score: hardExcluded ? 0 : 10,
    reasons: hardExcluded ? [] : ["Patient has X"],
    hardExcluded,
    exclusionReason,
  };
}

const eligibleVerdict: EligibilityVerdict = {
  verdict: "ELIGIBLE",
  criteria_results: [],
  gaps: [],
};

interface SseEvent {
  event: string;
  data: unknown;
}

async function readSse(res: Response): Promise<SseEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
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
      events.push({ event, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}

describe("POST /api/match-all — validation", () => {
  beforeEach(() => {
    mockLoadTrials.mockReset();
    mockFilter.mockReset();
    mockEvaluate.mockReset();
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await POST(makeRequest("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid JSON body/);
  });

  it("returns 400 on missing/invalid bundle", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid FHIR bundle/);
  });

  it("returns 413 when bundle.entry exceeds 500", async () => {
    const bigBundle: FHIRBundle = {
      resourceType: "Bundle",
      entry: Array.from({ length: 501 }, (_, i) => ({
        resource: { resourceType: "Patient" as const, id: `p${i}` },
      })),
    };
    const res = await POST(makeRequest({ bundle: bigBundle }));
    expect(res.status).toBe(413);
  });

  it("returns 400 when maxTrials exceeds 20", async () => {
    const res = await POST(
      makeRequest({ bundle: validBundle, maxTrials: 21 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/exceeds 20/);
  });

  it("returns 400 when maxTrials is not a positive integer", async () => {
    const res = await POST(makeRequest({ bundle: validBundle, maxTrials: 0 }));
    expect(res.status).toBe(400);
    const res2 = await POST(
      makeRequest({ bundle: validBundle, maxTrials: 1.5 }),
    );
    expect(res2.status).toBe(400);
  });

  it("returns 500 when loadTrials throws", async () => {
    mockLoadTrials.mockImplementationOnce(() => {
      throw new Error("corpus missing");
    });
    const res = await POST(makeRequest({ bundle: validBundle }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed to load trial corpus/);
  });
});

describe("POST /api/match-all — SSE pipeline", () => {
  beforeEach(() => {
    mockLoadTrials.mockReset();
    mockFilter.mockReset();
    mockEvaluate.mockReset();
  });

  it("streams retrieval → trial-complete → progress → done in order", async () => {
    const trialA = makeTrial("NCT-A", "Trial A");
    const trialB = makeTrial("NCT-B", "Trial B");
    const trialX = makeTrial("NCT-X", "Trial X excluded");
    const candidates: RetrievalResult[] = [
      makeCandidate(trialA),
      makeCandidate(trialB),
      makeCandidate(trialX, true, "Trial requires FEMALE patients"),
    ];

    mockLoadTrials.mockReturnValueOnce([trialA, trialB, trialX]);
    mockFilter.mockReturnValueOnce(candidates);

    mockEvaluate.mockImplementationOnce(async (_bundle, _cands, opts) => {
      const evals: TrialEvaluation[] = [];
      for (const t of [trialA, trialB]) {
        const evaluation: TrialEvaluation = {
          trial: t,
          retrievalScore: 10,
          retrievalReasons: ["Patient has X"],
          verdict: eligibleVerdict,
        };
        evals.push(evaluation);
        opts?.onTrialComplete?.(evaluation);
        opts?.onProgress?.(evals.length, 2, t.nctId);
      }
      return {
        evaluations: evals,
        hardExcluded: [candidates[2]],
        summary: {
          totalConsidered: 3,
          evaluated: 2,
          eligible: 2,
          ineligible: 0,
          needsMoreData: 0,
          errors: 0,
          hardExcluded: 1,
        },
        totalDurationMs: 1,
      };
    });

    const res = await POST(makeRequest({ bundle: validBundle }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");

    const events = await readSse(res);
    const eventNames = events.map((e) => e.event);
    expect(eventNames[0]).toBe("retrieval");
    expect(eventNames[eventNames.length - 1]).toBe("done");
    expect(eventNames.filter((n) => n === "trial-complete")).toHaveLength(2);
    expect(eventNames.filter((n) => n === "progress")).toHaveLength(2);

    const retrievalEvent = events[0].data as {
      totalConsidered: number;
      hardExcluded: { trial: { nctId: string } }[];
      topCandidates: { trial: { nctId: string } }[];
    };
    expect(retrievalEvent.totalConsidered).toBe(3);
    expect(retrievalEvent.hardExcluded).toHaveLength(1);
    expect(retrievalEvent.topCandidates.map((c) => c.trial.nctId)).toEqual([
      "NCT-A",
      "NCT-B",
    ]);

    const doneEvent = events[events.length - 1].data as {
      summary: { evaluated: number; eligible: number };
      evaluations: { trial: { nctId: string } }[];
    };
    expect(doneEvent.summary.evaluated).toBe(2);
    expect(doneEvent.summary.eligible).toBe(2);
    expect(doneEvent.evaluations).toHaveLength(2);
  });

  it("emits an error event when the engine throws", async () => {
    const trialA = makeTrial("NCT-A", "Trial A");
    mockLoadTrials.mockReturnValueOnce([trialA]);
    mockFilter.mockReturnValueOnce([makeCandidate(trialA)]);
    mockEvaluate.mockRejectedValueOnce(new Error("kaboom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest({ bundle: validBundle }));
    const events = await readSse(res);
    const last = events[events.length - 1];
    expect(last.event).toBe("error");
    expect((last.data as { error: string }).error).toMatch(/kaboom/);
    errSpy.mockRestore();
  });
});
