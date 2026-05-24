import { anthropic, MODEL } from "../criteria-parser/client";
import type {
  Criterion,
  FHIRResource,
  MatchResult,
  MatchStatus,
} from "../types";

export const SYSTEM_PROMPT = `You are a clinical-trial eligibility evaluator. You receive ONE eligibility criterion and a JSON array of relevant FHIR resources from a patient bundle. Your job is to decide whether the criterion as written is satisfied by the evidence.

STATUS SEMANTICS — CRITICAL
- "met" means: the criterion as written is satisfied by the evidence.
  * For an INCLUSION criterion: the patient meets the inclusion requirement.
  * For an EXCLUSION criterion: the patient HAS the excluded condition or factor. (They would later be excluded from the trial — but at this step, "met" still means "the criterion's described condition is true of the patient".)
- "not_met" means: the evidence shows the criterion is NOT satisfied by the patient.
- "needs_more_data" means: the evidence is insufficient to decide. The required data category is present but no specific resource conclusively answers the question.

Status is a property of the criterion-vs-evidence comparison — it is NOT a verdict on the patient's overall trial eligibility. A downstream aggregator combines statuses with criterion type to compute eligibility.

WORKED EXAMPLES
- Inclusion "Adults aged 45 to 75" + Patient with birthDate 1971-03-15 (age 55) → status "met".
- Inclusion "HbA1c between 6.5% and 8.5%" + Observation HbA1c = 7.2% → status "met".
- Inclusion "HbA1c between 6.5% and 8.5%" + Observation HbA1c = 9.4% → status "not_met".
- Exclusion "History of MI within the past 12 months" + no MI condition in evidence → status "not_met" (patient does NOT have the excluded condition — the eligible direction).
- Exclusion "History of MI within the past 12 months" + active MI condition recorded 3 months ago → status "met" (patient HAS the excluded condition — the ineligible direction).
- Inclusion "eGFR >= 45 mL/min/1.73m^2" + no eGFR Observation present in evidence → status "needs_more_data".

REASONING
- One or two sentences.
- Quote the specific data point(s) when possible (e.g., "HbA1c 7.2% on 2026-03-18").
- Do not hedge beyond what the data warrants.

CITATIONS
- citedResourceIds must list the .id values of the specific FHIR resources you used from the evidence array.
- Do NOT invent IDs; only use IDs present in the evidence.
- For "needs_more_data", citedResourceIds may be empty.

OUTPUT FORMAT
- Return ONLY a JSON object. No prose. No markdown code fences. No preamble or trailing commentary.
- Schema:
  {
    "status": "met" | "not_met" | "needs_more_data",
    "reasoning": "string (1-2 sentences)",
    "citedResourceIds": ["resource-id-1", "resource-id-2"]
  }`;

export function buildUserPrompt(
  criterion: Criterion,
  evidence: FHIRResource[],
): string {
  return `Evaluate this single eligibility criterion against the patient evidence below.

<criterion>
id: ${criterion.id}
type: ${criterion.type}
text: ${criterion.text}
</criterion>

<evidence>
${JSON.stringify(evidence, null, 2)}
</evidence>

Return ONLY the JSON object per the system instructions.`;
}

interface LLMEvalResult {
  status: MatchStatus;
  reasoning: string;
  citedResourceIds: string[];
}

function stripJsonFences(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\r?\n?/, "").replace(/\r?\n?```\s*$/, "");
  }
  return s.trim();
}

function validateEvalResult(parsed: unknown, criterionId: string): LLMEvalResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Evaluator response for ${criterionId} is not a JSON object: ${JSON.stringify(parsed)}`,
    );
  }
  const obj = parsed as Record<string, unknown>;

  if (
    obj.status !== "met" &&
    obj.status !== "not_met" &&
    obj.status !== "needs_more_data"
  ) {
    throw new Error(
      `Evaluator response for ${criterionId} has invalid 'status' (must be 'met' | 'not_met' | 'needs_more_data'): ${JSON.stringify(parsed)}`,
    );
  }

  if (typeof obj.reasoning !== "string" || obj.reasoning.length === 0) {
    throw new Error(
      `Evaluator response for ${criterionId} has missing or empty 'reasoning': ${JSON.stringify(parsed)}`,
    );
  }

  if (!Array.isArray(obj.citedResourceIds)) {
    throw new Error(
      `Evaluator response for ${criterionId} has missing or non-array 'citedResourceIds': ${JSON.stringify(parsed)}`,
    );
  }
  for (const cid of obj.citedResourceIds) {
    if (typeof cid !== "string") {
      throw new Error(
        `Evaluator response for ${criterionId} has non-string entry in citedResourceIds: ${JSON.stringify(parsed)}`,
      );
    }
  }

  return {
    status: obj.status,
    reasoning: obj.reasoning,
    citedResourceIds: obj.citedResourceIds as string[],
  };
}

export async function evaluateCriterion(
  criterion: Criterion,
  evidence: FHIRResource[],
): Promise<MatchResult> {
  if (evidence.length === 0) {
    return {
      criterion,
      status: "needs_more_data",
      evidence: [],
      reasoning: `No relevant FHIR resources found for required data types: ${criterion.requiredData.join(", ")}`,
    };
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(criterion, evidence) }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error(
      `Expected first content block to be text for ${criterion.id}, got: ${block?.type ?? "undefined"}`,
    );
  }

  const cleaned = stripJsonFences(block.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to JSON.parse evaluator response for ${criterion.id}: ${msg}. Raw text (first 500 chars): ${cleaned.slice(0, 500)}`,
    );
  }

  const result = validateEvalResult(parsed, criterion.id);

  const idSet = new Set(result.citedResourceIds);
  let citedEvidence = evidence.filter((r) => idSet.has(r.id));

  if (result.citedResourceIds.length === 0 && result.status !== "needs_more_data") {
    console.warn(
      `evaluateCriterion(${criterion.id}): status is '${result.status}' but citedResourceIds is empty; falling back to all gathered evidence (${evidence.length} resources).`,
    );
    citedEvidence = evidence;
  }

  return {
    criterion,
    status: result.status,
    evidence: citedEvidence,
    reasoning: result.reasoning,
  };
}
