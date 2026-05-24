import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Criterion, EligibilityVerdict, FHIRBundle } from "@/lib/types";

const { mockParseCriteria, mockEvaluateEligibility } = vi.hoisted(() => ({
  mockParseCriteria: vi.fn(),
  mockEvaluateEligibility: vi.fn(),
}));

vi.mock("@/lib/criteria-parser", () => ({
  parseCriteria: mockParseCriteria,
}));

vi.mock("@/lib/eligibility-engine", () => ({
  evaluateEligibility: mockEvaluateEligibility,
}));

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/match", {
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
        birthDate: "1971-03-15",
      },
    },
  ],
};

const validCriteriaText =
  "Inclusion Criteria:\n- Adults aged 18-65\n\nExclusion Criteria:\n- History of cancer";

const c1: Criterion = {
  id: "C1",
  text: "Adults aged 18-65",
  type: "inclusion",
  requiredData: ["Patient"],
};

const okVerdict: EligibilityVerdict = {
  verdict: "ELIGIBLE",
  criteria_results: [
    { criterion: c1, status: "met", evidence: [], reasoning: "ok" },
  ],
  gaps: [],
};

describe("POST /api/match — validation", () => {
  beforeEach(() => {
    mockParseCriteria.mockReset();
    mockEvaluateEligibility.mockReset();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(makeRequest("{not valid json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON body/i);
    expect(mockParseCriteria).not.toHaveBeenCalled();
  });

  it("returns 400 when bundle is missing", async () => {
    const res = await POST(makeRequest({ criteriaText: validCriteriaText }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid FHIR bundle/);
  });

  it("returns 400 when bundle.resourceType is not 'Bundle'", async () => {
    const res = await POST(
      makeRequest({
        bundle: { resourceType: "OperationOutcome", entry: [] },
        criteriaText: validCriteriaText,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid FHIR bundle/);
  });

  it("returns 400 when bundle.entry is not an array", async () => {
    const res = await POST(
      makeRequest({
        bundle: { resourceType: "Bundle", entry: "not-an-array" },
        criteriaText: validCriteriaText,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/entry array/);
  });

  it("returns 400 when criteriaText is missing", async () => {
    const res = await POST(makeRequest({ bundle: validBundle }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/criteriaText is required/);
  });

  it("returns 400 when criteriaText is empty string", async () => {
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: "" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/criteriaText is required/);
  });

  it("returns 400 when criteriaText is whitespace only", async () => {
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: "   \n  \t " }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/criteriaText is required/);
  });

  it("returns 400 when criteriaText exceeds 10000 chars", async () => {
    const tooLong = "x".repeat(10_001);
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: tooLong }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/exceeds maximum length of 10000/);
  });

  it("returns 413 when bundle.entry exceeds 500 items", async () => {
    const bigBundle: FHIRBundle = {
      resourceType: "Bundle",
      entry: Array.from({ length: 501 }, (_, i) => ({
        resource: {
          resourceType: "Patient" as const,
          id: `p${i}`,
        },
      })),
    };
    const res = await POST(
      makeRequest({ bundle: bigBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/maximum size of 500 entries/);
  });
});

describe("POST /api/match — pipeline", () => {
  beforeEach(() => {
    mockParseCriteria.mockReset();
    mockEvaluateEligibility.mockReset();
  });

  it("returns 422 when parseCriteria returns an empty array", async () => {
    mockParseCriteria.mockResolvedValueOnce([]);
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/No criteria could be parsed/);
    expect(mockEvaluateEligibility).not.toHaveBeenCalled();
  });

  it("returns 200 with the verdict on the happy path", async () => {
    mockParseCriteria.mockResolvedValueOnce([c1]);
    mockEvaluateEligibility.mockResolvedValueOnce(okVerdict);
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as EligibilityVerdict;
    expect(body.verdict).toBe("ELIGIBLE");
    expect(body.criteria_results).toHaveLength(1);
    expect(body.gaps).toEqual([]);
    expect(mockParseCriteria).toHaveBeenCalledWith(validCriteriaText);
    expect(mockEvaluateEligibility).toHaveBeenCalledWith(validBundle, [c1]);
  });

  it("logs parse/eval/total timings on success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockParseCriteria.mockResolvedValueOnce([c1]);
    mockEvaluateEligibility.mockResolvedValueOnce(okVerdict);
    await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[match\] parsed 1 criteria in \d+ms, evaluated in \d+ms, total \d+ms$/,
      ),
    );
    logSpy.mockRestore();
  });
});

describe("POST /api/match — error handling", () => {
  beforeEach(() => {
    mockParseCriteria.mockReset();
    mockEvaluateEligibility.mockReset();
  });

  it("returns 502 when parseCriteria throws a validation error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockParseCriteria.mockRejectedValueOnce(
      new Error("validation failed: bad shape"),
    );
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Upstream LLM returned invalid response/);
    expect(body.detail).toMatch(/validation failed/);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 502 when evaluateEligibility throws a validation-shaped error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockParseCriteria.mockResolvedValueOnce([c1]);
    mockEvaluateEligibility.mockRejectedValueOnce(
      new Error("Evaluator response for C1 has invalid 'status'"),
    );
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Upstream LLM returned invalid response/);
    errSpy.mockRestore();
  });

  it("returns 500 when evaluateEligibility throws a generic error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockParseCriteria.mockResolvedValueOnce([c1]);
    mockEvaluateEligibility.mockRejectedValueOnce(new Error("network down"));
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Internal server error/);
    expect(body.detail).toMatch(/network down/);
    errSpy.mockRestore();
  });

  it("returns 500 with 'missing API key' when error message mentions ANTHROPIC_API_KEY", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockParseCriteria.mockRejectedValueOnce(
      new Error("ANTHROPIC_API_KEY environment variable is not set."),
    );
    const res = await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Server misconfiguration: missing API key/);
    errSpy.mockRestore();
  });

  it("logs every caught error to console.error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockParseCriteria.mockRejectedValueOnce(new Error("boom"));
    await POST(
      makeRequest({ bundle: validBundle, criteriaText: validCriteriaText }),
    );
    expect(errSpy).toHaveBeenCalledWith(
      "[match] error:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});
