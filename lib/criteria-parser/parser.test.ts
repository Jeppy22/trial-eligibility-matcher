import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import type { Criterion } from "../types";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("./client", () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: "claude-sonnet-4-5-20250929",
}));

import { parseCriteria } from "./parser";

function asTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const wellFormed: Criterion[] = [
  {
    id: "C1",
    text: "Adults aged 45 to 75 years.",
    type: "inclusion",
    requiredData: ["Patient"],
  },
  {
    id: "C2",
    text: "Diagnosis of type 2 diabetes mellitus.",
    type: "inclusion",
    requiredData: ["Condition"],
  },
  {
    id: "C3",
    text: "HbA1c between 6.5% and 8.5%.",
    type: "inclusion",
    requiredData: ["Observation"],
  },
];

describe("parseCriteria — unit (mocked client)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns a valid Criterion[] for well-formed JSON", async () => {
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(wellFormed)));
    const result = await parseCriteria("ignored input");

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("C1");
    expect(result[0].type).toBe("inclusion");
    expect(result[0].requiredData).toEqual(["Patient"]);
    expect(result[2].requiredData).toEqual(["Observation"]);
  });

  it("strips fenced ```json ... ``` wrappers if the model adds them", async () => {
    const fenced = "```json\n" + JSON.stringify(wellFormed) + "\n```";
    mockCreate.mockResolvedValueOnce(asTextResponse(fenced));
    const result = await parseCriteria("ignored");
    expect(result).toHaveLength(3);
  });

  it("strips bare ``` ... ``` wrappers too", async () => {
    const fenced = "```\n" + JSON.stringify(wellFormed) + "\n```";
    mockCreate.mockResolvedValueOnce(asTextResponse(fenced));
    const result = await parseCriteria("ignored");
    expect(result).toHaveLength(3);
  });

  it("throws when the model returns text that is not valid JSON", async () => {
    mockCreate.mockResolvedValueOnce(asTextResponse("this is not json at all"));
    await expect(parseCriteria("ignored")).rejects.toThrow(/JSON\.parse/);
  });

  it("throws when the top-level JSON is not an array", async () => {
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify({ id: "C1" })));
    await expect(parseCriteria("ignored")).rejects.toThrow(/array/i);
  });

  it("throws when an item is missing requiredData", async () => {
    const bad = [{ id: "C1", text: "Adults aged 45-75", type: "inclusion" }];
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(bad)));
    await expect(parseCriteria("ignored")).rejects.toThrow(/requiredData/);
  });

  it("throws when type is not 'inclusion' or 'exclusion'", async () => {
    const bad = [
      { id: "C1", text: "Adults aged 45-75", type: "maybe", requiredData: ["Patient"] },
    ];
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(bad)));
    await expect(parseCriteria("ignored")).rejects.toThrow(/type/);
  });

  it("throws when requiredData contains an unknown FHIRResourceType", async () => {
    const bad = [
      { id: "C1", text: "Adults aged 45-75", type: "inclusion", requiredData: ["Goblin"] },
    ];
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(bad)));
    await expect(parseCriteria("ignored")).rejects.toThrow(/Goblin|FHIRResourceType/);
  });

  it("throws when an item is missing id", async () => {
    const bad = [
      { text: "Adults aged 45-75", type: "inclusion", requiredData: ["Patient"] },
    ];
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(bad)));
    await expect(parseCriteria("ignored")).rejects.toThrow(/id/);
  });

  it("throws when text is empty", async () => {
    const bad = [
      { id: "C1", text: "", type: "inclusion", requiredData: ["Patient"] },
    ];
    mockCreate.mockResolvedValueOnce(asTextResponse(JSON.stringify(bad)));
    await expect(parseCriteria("ignored")).rejects.toThrow(/text/);
  });
});

describe("parseCriteria — integration (real Anthropic API)", () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.RUN_INTEGRATION_TESTS)(
    "parses the sample trial-criteria.txt against the real API",
    async () => {
      vi.doUnmock("./client");
      vi.resetModules();
      const { parseCriteria: realParse } = await import("./parser");

      const criteriaText = fs.readFileSync(
        path.resolve(process.cwd(), "sample-data", "trial-criteria.txt"),
        "utf-8",
      );

      const result = await realParse(criteriaText);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const types = new Set(result.map((c) => c.type));
      expect(types.has("inclusion")).toBe(true);
      expect(types.has("exclusion")).toBe(true);

      for (const c of result) {
        expect(c.text.length).toBeGreaterThan(0);
        expect(c.requiredData.length).toBeGreaterThan(0);
      }

      const ageCriterion = result.find((c) => /45\s*to\s*75/i.test(c.text));
      expect(ageCriterion, "expected an age criterion mentioning '45 to 75'").toBeDefined();
      expect(ageCriterion!.requiredData).toContain("Patient");

      const hba1cCriterion = result.find((c) => /hba1c/i.test(c.text));
      expect(hba1cCriterion, "expected an HbA1c criterion").toBeDefined();
      expect(hba1cCriterion!.requiredData).toContain("Observation");

      const metforminCriterion = result.find((c) => /metformin/i.test(c.text));
      expect(metforminCriterion, "expected a metformin criterion").toBeDefined();
      expect(metforminCriterion!.requiredData).toContain("MedicationRequest");
    },
    60_000,
  );
});
