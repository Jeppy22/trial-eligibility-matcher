import fs from "node:fs";
import path from "node:path";

async function main(): Promise<number> {
  const bundlePath = path.resolve(process.cwd(), "sample-data", "patient-bundle.json");
  const criteriaPath = path.resolve(process.cwd(), "sample-data", "trial-criteria.txt");

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  const criteriaText = fs.readFileSync(criteriaPath, "utf-8");

  const url = process.env.MATCH_ENDPOINT ?? "http://localhost:3000/api/match";
  console.log(`POST ${url}`);
  console.log(`  bundle:       ${bundle.entry.length} entries`);
  console.log(`  criteriaText: ${criteriaText.length} chars`);
  console.log();

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle, criteriaText }),
    });
  } catch (err) {
    console.error("Request failed:", err instanceof Error ? err.message : err);
    return 1;
  }
  const elapsedMs = Date.now() - start;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  console.log(`Status: ${response.status} (${elapsedMs}ms)`);
  console.log(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));

  return response.status === 200 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Smoke test crashed:", err);
    process.exit(1);
  });
