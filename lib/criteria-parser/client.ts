import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-4-6-20250929";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error(
    "ANTHROPIC_API_KEY environment variable is not set. " +
      "Add it to .env.local (see .env.example for the expected shape).",
  );
}

export const anthropic = new Anthropic({ apiKey });
