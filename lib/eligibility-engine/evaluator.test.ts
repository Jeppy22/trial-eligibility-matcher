import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Criterion, FHIRResource } from "../types";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("../criteria-parser/client", () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: "claude-sonnet-4-6-20250929",
}));

import { evaluateCriterion } from "./evaluator";

function asTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const ageCriterion: Criterion = {
  id: "C1",
  text: "Adults aged 45 to 75 years.",
  type: "inclusion",
  requiredData: ["Patient"],
};

const patient: FHIRResource = {
  resourceType: "Patient",
  id: "patient-001",
  gender: "male",
  birthDate: "1971-03-15",
};

const hba1cObs: FHIRResource = {
  resourceType: "Observation",
  id: "observation-hba1c",
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "4548-4" }] },
  subject: { reference: "Patient/patient-001" },
  valueQuantity: { value: 7.2, unit: "%" },
};

describe("evaluateCriterion — unit (mocked client)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns needs_more_data without calling the API when evidence is empty", async () => {
    const result = await evaluateCriterion(ageCriterion, []);
    expect(result.status).toBe("needs_more_data");
    expect(result.evidence).toEqual([]);
    expect(result.reasoning).toMatch(/no relevant FHIR resources/i);
    expect(result.reasoning).toMatch(/Patient/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps a valid LLM response to MatchResult and filters evidence by citedResourceIds", async () => {
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({
          status: "met",
          reasoning: "Patient born 1971-03-15 is 55, within 45-75.",
          citedResourceIds: ["patient-001"],
        }),
      ),
    );
    const result = await evaluateCriterion(ageCriterion, [patient, hba1cObs]);

    expect(result.status).toBe("met");
    expect(result.reasoning).toMatch(/55/);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].id).toBe("patient-001");
    expect(result.criterion).toBe(ageCriterion);
  });

  it("strips ```json fences if the model emits them", async () => {
    const fenced =
      "```json\n" +
      JSON.stringify({
        status: "met",
        reasoning: "ok",
        citedResourceIds: ["patient-001"],
      }) +
      "\n```";
    mockCreate.mockResolvedValueOnce(asTextResponse(fenced));
    const result = await evaluateCriterion(ageCriterion, [patient]);
    expect(result.status).toBe("met");
  });

  it("throws when status is not one of the three allowed values", async () => {
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({ status: "maybe", reasoning: "x", citedResourceIds: [] }),
      ),
    );
    await expect(evaluateCriterion(ageCriterion, [patient])).rejects.toThrow(
      /status/,
    );
  });

  it("throws when JSON is malformed", async () => {
    mockCreate.mockResolvedValueOnce(asTextResponse("not valid json"));
    await expect(evaluateCriterion(ageCriterion, [patient])).rejects.toThrow(
      /JSON\.parse/,
    );
  });

  it("throws when reasoning is empty", async () => {
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({
          status: "met",
          reasoning: "",
          citedResourceIds: ["patient-001"],
        }),
      ),
    );
    await expect(evaluateCriterion(ageCriterion, [patient])).rejects.toThrow(
      /reasoning/,
    );
  });

  it("throws when citedResourceIds is not an array", async () => {
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({
          status: "met",
          reasoning: "ok",
          citedResourceIds: "patient-001",
        }),
      ),
    );
    await expect(evaluateCriterion(ageCriterion, [patient])).rejects.toThrow(
      /citedResourceIds/,
    );
  });

  it("falls back to all evidence and warns when citedResourceIds is empty but status is 'met'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({
          status: "met",
          reasoning: "Patient meets criterion.",
          citedResourceIds: [],
        }),
      ),
    );
    const result = await evaluateCriterion(ageCriterion, [patient, hba1cObs]);
    expect(result.status).toBe("met");
    expect(result.evidence).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/citedResourceIds is empty/i);
    warnSpy.mockRestore();
  });

  it("does NOT warn or fall back when citedResourceIds is empty and status is 'needs_more_data'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce(
      asTextResponse(
        JSON.stringify({
          status: "needs_more_data",
          reasoning: "Insufficient data to decide.",
          citedResourceIds: [],
        }),
      ),
    );
    const result = await evaluateCriterion(ageCriterion, [patient]);
    expect(result.status).toBe("needs_more_data");
    expect(result.evidence).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
