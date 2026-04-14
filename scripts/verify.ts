#!/usr/bin/env node

import { readFileSync, existsSync, realpathSync } from "fs";
import { join, resolve } from "path";
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

function printVerifyHelp(): void {
  console.log(`Usage: api-client-verify [options]

Verify that the OpenAPI spec and generated client still match api-client.manifest.json.
Run this before production builds (see README).

Options:
  --help, -h     Show this message

Typical npm script:
  "build": "api-client-verify && tsc"
`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printVerifyHelp();
    return;
  }
  try {
    await verify();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const argvReal = realpathSync(resolve(entry));
    const moduleReal = realpathSync(resolve(fileURLToPath(import.meta.url)));
    return argvReal === moduleReal;
  } catch {
    return false;
  }
}

if (isExecutedAsCli()) {
  main();
}
