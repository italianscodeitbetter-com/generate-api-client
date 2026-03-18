#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  normalizedJsonHash,
  computeClientHash,
} from "./hash.js";

interface Manifest {
  docsSource: string;
  docsHash: string;
  clientHash: string;
  out: string;
  generatedAt?: string;
}

async function loadRawSpec(urlOrPath: string): Promise<unknown> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    const res = await fetch(urlOrPath);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch spec: ${res.status} ${res.statusText}`,
      );
    }
    return res.json();
  }
  return JSON.parse(readFileSync(urlOrPath, "utf-8"));
}

export interface VerifyOptions {
  cwd?: string;
  manifestPath?: string;
}

export async function verify(options: VerifyOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath =
    options.manifestPath ?? join(cwd, "api-client.manifest.json");

  if (!existsSync(manifestPath)) {
    throw new Error(
      "No manifest found. Run `npm run generate` first.",
    );
  }

  const manifest: Manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  );

  if (
    !manifest.docsSource ||
    !manifest.docsHash ||
    !manifest.clientHash ||
    !manifest.out
  ) {
    throw new Error(
      "Invalid manifest: missing docsSource, docsHash, clientHash, or out.",
    );
  }

  const rawSpec = await loadRawSpec(manifest.docsSource);
  const currentDocsHash = normalizedJsonHash(rawSpec);

  if (currentDocsHash !== manifest.docsHash) {
    throw new Error(
      "API docs have changed. Run `npm run generate` to regenerate the client, then update your application.",
    );
  }

  const currentClientHash = computeClientHash(cwd, manifest.out);

  if (currentClientHash !== manifest.clientHash) {
    throw new Error(
      "Generated client files were modified. Run `npm run generate` to regenerate.",
    );
  }
}

async function main(): Promise<void> {
  try {
    await verify();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main();
}
