import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { verify } from "../verify.js";

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
const fixtureV2Path = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "minimal-openapi-v2.json",
);

describe("verify", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "verify-test-"));
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );
  });

  it("passes when manifest and current state match", async () => {
    await expect(verify({ cwd: tempDir })).resolves.toBeUndefined();
  });

  it("fails when docs changed", async () => {
    const manifestPath = join(tempDir, "api-client.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.docsSource = fixtureV2Path;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(verify({ cwd: tempDir })).rejects.toThrow(
      "API docs have changed. Run `npm run generate` to regenerate the client, then update your application.",
    );
  });

  it("fails when client was modified", async () => {
    // Restore manifest to use original fixture
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`,
      { cwd: tempDir },
    );

    const itemsPath = join(tempDir, "api", "contexts", "items.ts");
    const content = readFileSync(itemsPath, "utf-8");
    writeFileSync(itemsPath, content + "\n// manual edit");

    await expect(verify({ cwd: tempDir })).rejects.toThrow(
      "Generated client files were modified. Run `npm run generate` to regenerate.",
    );
  });

  it("fails when manifest is missing", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "verify-no-manifest-"));

    await expect(verify({ cwd: emptyDir })).rejects.toThrow(
      "No manifest found. Run `npm run generate` first.",
    );
  });

  it("fails when docs fetch fails", async () => {
    const manifestPath = join(tempDir, "api-client.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.docsSource = join(tempDir, "non-existent-spec.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(verify({ cwd: tempDir })).rejects.toThrow();
  });
});
