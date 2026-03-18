import { createHash } from "crypto";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

/** Recursively sort object keys for deterministic JSON hashing */
export function sortKeysRecursive(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysRecursive);
  return Object.keys(obj)
    .sort()
    .reduce(
      (acc, k) => {
        acc[k] = sortKeysRecursive((obj as Record<string, unknown>)[k]);
        return acc;
      },
      {} as Record<string, unknown>,
    );
}

/** SHA256 hash of normalized JSON (deterministic regardless of key order) */
export function normalizedJsonHash(obj: unknown): string {
  const str = JSON.stringify(sortKeysRecursive(obj));
  return createHash("sha256").update(str).digest("hex");
}

/** Deterministic file list for client hash: types/index.ts, client.ts, apiClient.ts, index.ts, contexts/*.ts (sorted) */
const CLIENT_FILE_ORDER = [
  "types/index.ts",
  "client.ts",
  "apiClient.ts",
  "index.ts",
];

/** Compute SHA256 hash of all generated client files in deterministic order */
export function computeClientHash(
  baseDir: string,
  outSubdir: string,
): string {
  const outDir = join(baseDir, outSubdir);
  const hash = createHash("sha256");

  for (const relPath of CLIENT_FILE_ORDER) {
    const fullPath = join(outDir, relPath);
    if (existsSync(fullPath)) {
      hash.update(readFileSync(fullPath, "utf-8"));
    }
  }

  const contextsDir = join(outDir, "contexts");
  if (existsSync(contextsDir)) {
    const contextFiles = readdirSync(contextsDir)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    for (const f of contextFiles) {
      hash.update(readFileSync(join(contextsDir, f), "utf-8"));
    }
  }

  return hash.digest("hex");
}
