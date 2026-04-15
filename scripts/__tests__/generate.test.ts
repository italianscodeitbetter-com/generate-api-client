import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { normalizedJsonHash, computeClientHash } from "../hash.js";
import { buildClientTypeScript, defaultClientGenOptions } from "../generate-client-template.js";

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
const openapi3ContentFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-content-response.json",
);
const openapi2BodyFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi2-body-response.json",
);
const blobExportFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "blob-export-openapi.json",
);
const openapi3ParameterRefsFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-parameter-refs.json",
);
const multipartUploadFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "multipart-upload-openapi.json",
);
const openapi3ArgsShapesFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-args-shapes.json",
);
const openapi3DanglingResponseRefFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-dangling-response-ref.json",
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
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: tempDir,
    });

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
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: tempDir,
    });

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    expect(manifest.docsSource).toBe(fixturePath);
  });

  it("manifest clientHash matches actual generated files", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: tempDir,
    });

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    const computedHash = computeClientHash(tempDir, "api");
    expect(manifest.clientHash).toBe(computedHash);
  });

  it("manifest docsHash matches fixture spec", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: tempDir,
    });

    const manifest = JSON.parse(
      readFileSync(join(tempDir, "api-client.manifest.json"), "utf-8"),
    );
    const fixtureSpec = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const computedDocsHash = normalizedJsonHash(fixtureSpec);
    expect(manifest.docsHash).toBe(computedDocsHash);
  });

  it("extracts response schema from OpenAPI 3.0 content (application/json)", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3ContentFixturePath}" --out api`,
      { cwd: tempDir },
    );

    const authContext = readFileSync(
      join(tempDir, "api", "contexts", "auth.ts"),
      "utf-8",
    );
    expect(authContext).toContain("LoginResponse");
    expect(authContext).toContain("client.post<LoginResponse>");
  });

  it("extracts request body schema from OpenAPI 3.0 requestBody", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3ContentFixturePath}" --out api`,
      { cwd: tempDir },
    );

    const itemContext = readFileSync(
      join(tempDir, "api", "contexts", "item.ts"),
      "utf-8",
    );
    expect(itemContext).toContain("UpdateItem");
    expect(itemContext).toMatch(/args.*data:\s*UpdateItem/s);
    expect(itemContext).not.toContain("params?: unknown");
    expect(itemContext).toContain("const { params, data } = args;");
  });

  it("does not widen args destructure with unknown", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3ContentFixturePath}" --out api-no-unknown-destructure`,
      { cwd: tempDir },
    );

    const authContext = readFileSync(
      join(tempDir, "api-no-unknown-destructure", "contexts", "auth.ts"),
      "utf-8",
    );
    expect(authContext).toContain("const { data } = args;");
    expect(authContext).not.toContain("params?: unknown");
    expect(authContext).not.toContain("query?: unknown");
    expect(authContext).not.toContain("data?: unknown");
  });

  it("destructures only keys present on each operation args type", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3ArgsShapesFixturePath}" --out api-args-shapes`,
      { cwd: tempDir },
    );

    const shapesContext = readFileSync(
      join(tempDir, "api-args-shapes", "contexts", "shapes.ts"),
      "utf-8",
    );
    expect(shapesContext).toContain("const { query } = args ?? {};");
    expect(shapesContext).toContain("const { data } = args;");
    expect(shapesContext).toContain("const { params } = args;");
    expect(shapesContext).toContain("const { params, data } = args;");
    expect(shapesContext).not.toContain("params?: unknown");
  });

  it("uses unknown when response $ref has no matching components/schemas entry", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3DanglingResponseRefFixturePath}" --out api-dangling-ref`,
      { cwd: tempDir },
    );

    const adminContext = readFileSync(
      join(tempDir, "api-dangling-ref", "contexts", "admin.ts"),
      "utf-8",
    );
    expect(adminContext).toContain("client.get<unknown>");
    expect(adminContext).not.toContain("HealthResponse");
  });

  it("extracts body and response from OpenAPI 2.0 (parameters in:body, responses.schema)", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi2BodyFixturePath}" --out api`,
      { cwd: tempDir },
    );

    const itemContext = readFileSync(
      join(tempDir, "api", "contexts", "item.ts"),
      "utf-8",
    );
    expect(itemContext).toContain("UpdateItem");
    expect(itemContext).toMatch(/args.*data:\s*UpdateItem/s);
    expect(itemContext).toContain("client.put<Item>");
  });

  it("resolves parameter $ref so query/path args are emitted", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3ParameterRefsFixturePath}" --out api-refs`,
      { cwd: tempDir },
    );

    const thingsContext = readFileSync(
      join(tempDir, "api-refs", "contexts", "things.ts"),
      "utf-8",
    );
    expect(thingsContext).toContain("page:");
    expect(thingsContext).toMatch(/query[^}]*page/s);
  });

  it("multipart/form-data builds FormData and types binary fields as Blob | File", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${multipartUploadFixturePath}" --out api-multipart`,
      { cwd: tempDir },
    );

    const typesSource = readFileSync(
      join(tempDir, "api-multipart", "types", "index.ts"),
      "utf-8",
    );
    expect(typesSource).toMatch(/Blob\s*\|\s*File/);

    const uploadContext = readFileSync(
      join(tempDir, "api-multipart", "contexts", "upload.ts"),
      "utf-8",
    );
    expect(uploadContext).toContain("new FormData()");
    expect(uploadContext).toContain("_formData.append(");
    expect(uploadContext).toContain(", _formData,");
    expect(uploadContext).not.toMatch(/\.post<[^>]+>\([^,]+,\s*data,/);
    expect(uploadContext).toMatch(
      /async uploadCsv\(args:\s*\{\s*query:\s*\{[^}]+\};\s*data:\s*CsvUploadBody\s*\}/s,
    );
    expect(uploadContext).toContain("const { query, data } = args;");
    expect(uploadContext).not.toContain("params?: unknown");
  });

  it("leaves full Axios response for blob endpoints so res.data and headers work", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${blobExportFixturePath}" --out api-blob`,
      { cwd: tempDir },
    );

    const clientSource = readFileSync(
      join(tempDir, "api-blob", "client.ts"),
      "utf-8",
    );
    expect(clientSource).toContain('responseType === "blob"');
    expect(clientSource).toContain('responseType === "arraybuffer"');
    expect(clientSource).toContain("setAuthRefreshHandler");
    expect(clientSource).toContain("AUTH_RETRY_MAX");

    const exportContext = readFileSync(
      join(tempDir, "api-blob", "contexts", "export.ts"),
      "utf-8",
    );
    expect(exportContext).toContain('responseType: "blob"');
    expect(exportContext).toContain("ensureBlobAxiosResponse(_raw)");
    expect(exportContext).toContain("triggerBlobDownload(res.data");
  });
});

describe("generate CLI", () => {
  const scriptPath = join(projectRoot, "scripts", "generate.ts");
  const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");

  it("--help prints options and exits without fetching", () => {
    const out = execSync(`"${tsxPath}" "${scriptPath}" --help`, {
      encoding: "utf-8",
    });
    expect(out).toContain("--url");
    expect(out).toContain("--override-client");
    expect(out).toContain("--auth");
    expect(out).toContain("--jwt-init");
  });
});

describe("buildClientTypeScript", () => {
  it("jwt lazy includes lazy hydration and localStorage helpers", () => {
    const src = buildClientTypeScript("http://t", {
      ...defaultClientGenOptions(),
      auth: "jwt",
      jwtInit: "lazy",
    });
    expect(src).toContain("_jwtHydrated");
    expect(src).toContain("readStorage");
  });

  it("none mode has no jwt localStorage helpers", () => {
    const src = buildClientTypeScript("http://t", {
      ...defaultClientGenOptions(),
      auth: "none",
    });
    expect(src).not.toContain("readStorage");
    expect(src).not.toContain("_jwtHydrated");
  });

  it("custom mode includes applyRequestAuth stub", () => {
    const src = buildClientTypeScript("http://t", {
      ...defaultClientGenOptions(),
      auth: "custom",
    });
    expect(src).toContain("function applyRequestAuth");
  });
});

describe("generate --auth jwt", () => {
  it("writes client.ts with jwt lazy implementation", () => {
    const dir = mkdtempSync(join(tmpdir(), "gen-baked-auth-"));
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api-baked --auth jwt --jwt-init lazy --override-client --yes`,
      { cwd: dir },
    );
    const clientSource = readFileSync(
      join(dir, "api-baked", "client.ts"),
      "utf-8",
    );
    expect(clientSource).toContain("_jwtHydrated");
    expect(clientSource).toContain("persistAccess");
  });
});
