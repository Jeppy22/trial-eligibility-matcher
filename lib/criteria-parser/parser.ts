import { anthropic, MODEL } from "./client";
import { SYSTEM_PROMPT, buildPrompt } from "./prompt";
import type { Criterion, FHIRResourceType } from "../types";

const VALID_RESOURCE_TYPES: ReadonlySet<string> = new Set<FHIRResourceType>([
  "Patient",
  "Condition",
  "Observation",
  "MedicationRequest",
  "Procedure",
]);

function stripJsonFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\r?\n?/, "").replace(/\r?\n?```\s*$/, "");
  }
  return s.trim();
}

function validateCriterion(item: unknown, index: number): Criterion {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(
      `Criterion at index ${index} is not a JSON object: ${JSON.stringify(item)}`,
    );
  }
  const obj = item as Record<string, unknown>;

  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new Error(
      `Criterion at index ${index} has missing or invalid 'id': ${JSON.stringify(item)}`,
    );
  }
  if (typeof obj.text !== "string" || obj.text.length === 0) {
    throw new Error(
      `Criterion at index ${index} has missing or invalid 'text': ${JSON.stringify(item)}`,
    );
  }
  if (obj.type !== "inclusion" && obj.type !== "exclusion") {
    throw new Error(
      `Criterion at index ${index} has invalid 'type' (must be 'inclusion' or 'exclusion'): ${JSON.stringify(item)}`,
    );
  }
  if (!Array.isArray(obj.requiredData)) {
    throw new Error(
      `Criterion at index ${index} is missing 'requiredData' array: ${JSON.stringify(item)}`,
    );
  }
  for (const rd of obj.requiredData) {
    if (typeof rd !== "string" || !VALID_RESOURCE_TYPES.has(rd)) {
      throw new Error(
        `Criterion at index ${index} has invalid FHIRResourceType '${String(rd)}' in requiredData: ${JSON.stringify(item)}`,
      );
    }
  }

  return {
    id: obj.id,
    text: obj.text,
    type: obj.type,
    requiredData: obj.requiredData as FHIRResourceType[],
  };
}

export async function parseCriteria(criteriaText: string): Promise<Criterion[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildPrompt(criteriaText) }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error(
      `Expected first content block to be text, got: ${block?.type ?? "undefined"}`,
    );
  }

  const cleaned = stripJsonFences(block.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to JSON.parse model response: ${msg}. Raw text (first 500 chars): ${cleaned.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected JSON array at top level, got: ${typeof parsed} (${JSON.stringify(parsed).slice(0, 200)})`,
    );
  }

  return parsed.map((item, i) => validateCriterion(item, i));
}
