/**
 * After `astro build`, write dist/config.json when build-time env supplies
 * deployment values. When every mapped env var is empty, write nothing so
 * generic images stay deployment-agnostic and mount their own config.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ENV_TO_JSON_KEY = {
  SITE_COMMUNITY_URL: "community_url",
  SITE_LOGO_HREF: "logo_href",
  VALIDATOR_CONTACT: "validator_contact",
  SITE_VALIDATOR_API_ORIGIN: "validator_api_origin",
} as const satisfies Record<string, string>;

function trimmedEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function buildConfigJsonRecord(): Record<string, string> | null {
  const record: Record<string, string> = {};
  for (const [envKey, jsonKey] of Object.entries(ENV_TO_JSON_KEY)) {
    const value = trimmedEnv(envKey);
    if (value !== "") {
      record[jsonKey] = value;
    }
  }
  return Object.keys(record).length > 0 ? record : null;
}

export async function writeConfigJson(outDir: string): Promise<boolean> {
  const record = buildConfigJsonRecord();
  if (record === null) {
    return false;
  }
  await mkdir(outDir, { recursive: true });
  const target = join(outDir, "config.json");
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return true;
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? join(import.meta.dir, "..", "dist");
  const written = await writeConfigJson(outDir);
  if (written) {
    console.log(`Wrote ${join(outDir, "config.json")}`);
  }
}
