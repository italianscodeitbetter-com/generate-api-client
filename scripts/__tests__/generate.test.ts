import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
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
const openapi3MultipartOverEmptyJsonFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-multipart-over-empty-json.json",
);
const openapi2FormdataUploadFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi2-formdata-upload.json",
);
const openapi3HyphenOperationIdSegmentsFixturePath = join(
  projectRoot,
  "scripts",
  "__tests__",
  "fixtures",
  "openapi3-hyphen-operation-id-segments.json",
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

  it("creates apiClient.custom.ts stub, apiClient.augment.ts scaffold, and wires augmentApiClient in apiClient.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "generate-api-custom-"));
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: dir,
    });

    const customPath = join(dir, "api", "apiClient.custom.ts");
    const augmentPath = join(dir, "api", "apiClient.augment.ts");
    expect(existsSync(customPath)).toBe(true);
    expect(existsSync(augmentPath)).toBe(true);
    expect(readFileSync(customPath, "utf-8")).toContain("apiClient.augment.js");
    expect(readFileSync(augmentPath, "utf-8")).toContain("GeneratedApiClient");

    const apiClientTs = readFileSync(join(dir, "api", "apiClient.ts"), "utf-8");
    expect(apiClientTs).toContain('import { augmentApiClient } from "./apiClient.custom.js"');
    expect(apiClientTs).toContain("export type GeneratedApiClient");
    expect(apiClientTs).toContain("augmentApiClient(_generatedApiClient)");
  });

  it("does not overwrite apiClient.augment.ts when it already exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "generate-api-custom-preserve-"));
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: dir,
    });

    const augmentPath = join(dir, "api", "apiClient.augment.ts");
    writeFileSync(
      augmentPath,
      `${readFileSync(augmentPath, "utf-8")}\n// USER_AUGMENT_SENTINEL\n`,
    );

    execSync(`"${tsxPath}" "${scriptPath}" --url "${fixturePath}" --out api`, {
      cwd: dir,
    });

    expect(readFileSync(augmentPath, "utf-8")).toContain("USER_AUGMENT_SENTINEL");
    expect(readFileSync(join(dir, "api", "apiClient.custom.ts"), "utf-8")).toContain(
      "apiClient.augment.js",
    );
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

  it("prefers multipart/form-data when application/json schema is empty", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3MultipartOverEmptyJsonFixturePath}" --out api-mj-empty-json`,
      { cwd: tempDir },
    );

    const ctx = readFileSync(
      join(tempDir, "api-mj-empty-json", "contexts", "building-media.ts"),
      "utf-8",
    );
    expect(ctx).toContain("new FormData()");
    expect(ctx).toMatch(/\.postForm</);
    expect(ctx).toContain("building_id");
    expect(ctx).toContain("uploadToBuilding");
    expect(ctx).toMatch(/data\??:\s*\{[^}]*file:\s*Blob\s*\|\s*File/s);
  });

  it("sanitizes operationId segments with hyphens to valid method names", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi3HyphenOperationIdSegmentsFixturePath}" --out api-hyphen-opid`,
      { cwd: tempDir },
    );

    const ctx = readFileSync(
      join(tempDir, "api-hyphen-opid", "contexts", "contract.ts"),
      "utf-8",
    );
    expect(ctx).toContain("async buildingRegistryModelsRead(");
    expect(ctx).toContain("async buildingRegistryModelsUpdate(");
    expect(ctx).not.toMatch(/async building-/);
    expect(ctx).toContain("client.put<Array<");
  });

  it("OpenAPI 2.0 formData parameters produce multipart client method", async () => {
    const scriptPath = join(projectRoot, "scripts", "generate.ts");
    const tsxPath = join(projectRoot, "node_modules", ".bin", "tsx");
    execSync(
      `"${tsxPath}" "${scriptPath}" --url "${openapi2FormdataUploadFixturePath}" --out api-oas2-formdata`,
      { cwd: tempDir },
    );

    const ctx = readFileSync(
      join(tempDir, "api-oas2-formdata", "contexts", "building-media.ts"),
      "utf-8",
    );
    expect(ctx).toContain("new FormData()");
    expect(ctx).toMatch(/\.postForm</);
    expect(ctx).toContain("building_id");
    expect(ctx).toContain("uploadToBuilding");
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
    expect(uploadContext).toMatch(/\.postForm</);
    expect(uploadContext).not.toMatch(/\.post<[^>]+>\([^,]+,\s*data,/);
    expect(uploadContext).toMatch(
      /async uploadCsv\(args:\s*\{\s*query:\s*\{[^}]+\};\s*data:\s*CsvUploadBody\s*\}/s,
    );
    expect(uploadContext).toContain("const { query, data } = args;");
    expect(uploadContext).not.toContain("params?: unknown");
  });

  it("response interceptor returns full AxiosResponse; blob contexts still use responseType blob", async () => {
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
    expect(clientSource).toMatch(/\(\s*response\s*\)\s*=>\s*response/);
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
