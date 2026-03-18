import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  normalizedJsonHash,
  computeClientHash,
} from "../hash.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");
const fixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "minimal-openapi.json",
);

describe("generate manifest", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "generate-test-"));
  });

  afterAll(() => {
    // Temp dir is cleaned by OS
  });

  it("creates manifest with docsHash, clientHash, docsSource", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );

    const manifestPath = join(tempDir, "api-client.manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest).toHaveProperty("docsSource");
    expect(manifest).toHaveProperty("docsHash");
    expect(manifest).toHaveProperty("clientHash");
    expect(manifest).toHaveProperty("out");
    expect(manifest).toHaveProperty("generatedAt");
    expect(typeof manifest.docsHash).toBe("string");
    expect(typeof manifest.clientHash).toBe("string");
  });

  it("manifest docsSource matches --url argument", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    expect(manifest.docsSource).toBe(fixturePath);
  });

  it("manifest clientHash matches actual generated files", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    const computedHash = computeClientHash(tempDir, "api");
    expect(manifest.clientHash).toBe(computedHash);
  });

  it("manifest docsHash matches fixture spec", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    const fixtureSpec = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const computedDocsHash = normalizedJsonHash(fixtureSpec);
    expect(manifest.docsHash).toBe(computedDocsHash);
  });
});
