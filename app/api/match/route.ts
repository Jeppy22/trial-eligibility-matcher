import { parseCriteria } from "@/lib/criteria-parser";
import { evaluateEligibility } from "@/lib/eligibility-engine";
import type { FHIRBundle } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_CRITERIA_LENGTH = 10_000;
const MAX_BUNDLE_ENTRIES = 3000;

const VALIDATION_ERROR_PATTERNS =
  /validation|Criterion at index|Evaluator response|Failed to JSON\.parse|Expected first content block to be text|Expected JSON array at top level/i;

interface MatchRequestBody {
  bundle?: unknown;
  criteriaText?: unknown;
}

function isBundleShape(b: unknown): b is FHIRBundle {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
  const obj = b as Record<string, unknown>;
  return obj.resourceType === "Bundle" && Array.isArray(obj.entry);
}

export async function POST(request: Request): Promise<Response> {
  const t0 = performance.now();

  let body: MatchRequestBody;
  try {
    body = (await request.json()) as MatchRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isBundleShape(body.bundle)) {
    return Response.json(
      {
        error:
          "Invalid FHIR bundle: must have resourceType 'Bundle' and an entry array",
      },
      { status: 400 },
    );
  }
  const bundle = body.bundle;

  if (
    typeof body.criteriaText !== "string" ||
    body.criteriaText.trim().length === 0
  ) {
    return Response.json(
      { error: "criteriaText is required and must be a non-empty string" },
      { status: 400 },
    );
  }
  const criteriaText = body.criteriaText;

  if (criteriaText.length > MAX_CRITERIA_LENGTH) {
    return Response.json(
      {
        error: `criteriaText exceeds maximum length of ${MAX_CRITERIA_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  if (bundle.entry.length > MAX_BUNDLE_ENTRIES) {
    return Response.json(
      { error: `Bundle exceeds maximum size of ${MAX_BUNDLE_ENTRIES} entries` },
      { status: 413 },
    );
  }

  try {
    const tParseStart = performance.now();
    const criteria = await parseCriteria(criteriaText);
    const tParseEnd = performance.now();

    if (criteria.length === 0) {
      return Response.json(
        { error: "No criteria could be parsed from the input" },
        { status: 422 },
      );
    }

    const verdict = await evaluateEligibility(bundle, criteria);
    const tEnd = performance.now();

    const parseMs = Math.round(tParseEnd - tParseStart);
    const evalMs = Math.round(tEnd - tParseEnd);
    const totalMs = Math.round(tEnd - t0);
    console.log(
      `[match] parsed ${criteria.length} criteria in ${parseMs}ms, evaluated in ${evalMs}ms, total ${totalMs}ms`,
    );

    return Response.json(verdict, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[match] error:", err);

    if (msg.includes("ANTHROPIC_API_KEY")) {
      return Response.json(
        { error: "Server misconfiguration: missing API key" },
        { status: 500 },
      );
    }

    if (VALIDATION_ERROR_PATTERNS.test(msg)) {
      return Response.json(
        { error: "Upstream LLM returned invalid response", detail: msg },
        { status: 502 },
      );
    }

    return Response.json(
      { error: "Internal server error", detail: msg },
      { status: 500 },
    );
  }
}
