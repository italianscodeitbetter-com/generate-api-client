#!/usr/bin/env node

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import SwaggerParser from "@apidevtools/swagger-parser";
import { normalizedJsonHash, computeClientHash } from "./hash.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal types for Swagger/OpenAPI (openapi-types exports vary by version)
interface SchemaObject {
  type?: string;
  $ref?: string;
  properties?: Record<
    string,
    SchemaObject & { description?: string; title?: string }
  >;
  items?: SchemaObject;
  required?: string[];
  format?: string;
  "x-nullable"?: boolean;
  description?: string;
  title?: string;
}
interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: ParameterObject[];
}
interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  responses?: Record<
    string,
    { description?: string; schema?: SchemaObject; "x-response-type"?: string }
  >;
  tags?: string[];
}
interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: SchemaObject;
}

const DEFAULT_OUT = "api";

function getDefaultUrl(): string {
  const base = process.env.BASE_URL;
  if (base) {
    const normalized = base.replace(/\/$/, "");
    return `${normalized}/docs/json`;
  }
  return "https://api.icib.dev/docs/?format=openapi";
}

interface CliArgs {
  url: string;
  out: string;
  basePath?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let url = getDefaultUrl();
  let out = DEFAULT_OUT;
  let basePath: string | undefined = process.env.BASE_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      out = args[++i];
    } else if (
      (args[i] === "--base-path" || args[i] === "--basePath") &&
      args[i + 1]
    ) {
      basePath = args[++i];
    }
  }

  return { url, out, basePath };
}

async function fetchSpec(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadRawSpec(urlOrPath: string): Promise<unknown> {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return fetchSpec(urlOrPath);
  }
  return JSON.parse(readFileSync(urlOrPath, "utf-8"));
}

async function parseSpec(spec: unknown): Promise<ParsedSpec> {
  return (await SwaggerParser.parse(
    spec as Parameters<typeof SwaggerParser.parse>[0],
  )) as ParsedSpec;
}

interface ParsedSpec {
  host?: string;
  schemes?: string[];
  basePath?: string;
  definitions?: Record<string, SchemaObject>;
  paths?: Record<string, PathItem>;
  servers?: Array<{ url: string }>;
  components?: { schemas?: Record<string, SchemaObject> };
  tags?: Array<{ name: string; description?: string }>;
}

function getBaseUrl(doc: ParsedSpec): string {
  const oas2 = doc as { host?: string; schemes?: string[]; basePath?: string };
  const oas3 = doc as { servers?: Array<{ url: string }> };

  if (oas2.host) {
    const scheme = oas2.schemes?.[0] ?? "https";
    const basePath = oas2.basePath ?? "";
    return `${scheme}://${oas2.host}${basePath}`;
  }

  if (oas3.servers?.[0]?.url) {
    return oas3.servers[0].url.replace(/\/$/, "");
  }

  return "https://api.icib.dev/api";
}

/** Returns origin only (no basePath) for axios baseURL when path includes basePath */
function getOrigin(doc: ParsedSpec): string {
  const oas2 = doc as { host?: string; schemes?: string[] };
  if (oas2.host) {
    const scheme = oas2.schemes?.[0] ?? "https";
    return `${scheme}://${oas2.host}`;
  }
  return "https://api.icib.dev";
}

function getDefinitions(doc: ParsedSpec): Record<string, SchemaObject> {
  return doc.definitions ?? doc.components?.schemas ?? {};
}

function getPaths(doc: ParsedSpec): Record<string, PathItem> {
  return doc.paths ?? {};
}

function schemaToTsType(
  schema: SchemaObject | undefined,
  definitions: Record<string, SchemaObject>,
  refsSeen: Set<string> = new Set(),
): string {
  if (!schema) return "unknown";

  const ref = schema.$ref;
  if (ref) {
    const match =
      ref.match(/#\/definitions\/(.+)$/) ??
      ref.match(/#\/components\/schemas\/(.+)$/);
    const name = match?.[1];
    if (name && !refsSeen.has(name)) {
      refsSeen.add(name);
      return name;
    }
    return name ?? "unknown";
  }

  const nullable = schema["x-nullable"] === true;

  if (schema.type === "array") {
    const items = schema.items;
    const itemType = schemaToTsType(items, definitions, refsSeen);
    const arr = `Array<${itemType}>`;
    return nullable ? `${arr} | null` : arr;
  }

  if (schema.type === "object") {
    if (schema.properties) {
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const propSchema = v as SchemaObject;
        const optional = !(schema.required ?? []).includes(k);
        const t = schemaToTsType(propSchema, definitions, refsSeen);
        return `  ${k}${optional ? "?" : ""}: ${t};`;
      });
      return `{\n${props.join("\n")}\n}`;
    }
    return "Record<string, unknown>";
  }

  const prim: Record<string, string> = {
    string: "string",
    integer: "number",
    number: "number",
    boolean: "boolean",
  };
  let t = prim[schema.type as string] ?? "unknown";
  if (schema.format === "date-time" || schema.format === "date") t = "string";
  if (schema.format === "uri") t = "string";
  return nullable ? `${t} | null` : t;
}

function generateTypes(definitions: Record<string, SchemaObject>): string {
  const lines: string[] = [
    "// Auto-generated types from OpenAPI definitions",
    "",
  ];

  for (const [name, schema] of Object.entries(definitions)) {
    const s = schema as SchemaObject;
    if (s.$ref) continue;

    const props: string[] = [];
    if (s.properties) {
      const required = new Set(s.required ?? []);
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        const optional = !required.has(propName);
        const t = schemaToTsType(propSchema as SchemaObject, definitions);
        const desc =
          (propSchema as { description?: string; title?: string })
            .description ??
          (propSchema as { description?: string; title?: string }).title;
        if (desc) {
          props.push(`  /** ${jsdocEscape(desc)} */`);
        }
        props.push(`  ${propName}${optional ? "?" : ""}: ${t};`);
      }
    }

    const ifaceDesc = (s as { description?: string }).description;
    if (s.type === "object" && !s.properties) {
      if (ifaceDesc) lines.push(`/** ${jsdocEscape(ifaceDesc)} */`);
      lines.push(`export interface ${name} {\n  [key: string]: unknown;\n}\n`);
    } else {
      if (ifaceDesc) lines.push(`/** ${jsdocEscape(ifaceDesc)} */`);
      lines.push(`export interface ${name} {`);
      lines.push(...props);
      lines.push("}\n");
    }
  }

  lines.push("export interface PaginatedResponse<T> {");
  lines.push("  count: number;");
  lines.push("  next: string | null;");
  lines.push("  previous: string | null;");
  lines.push("  results: T[];");
  lines.push("}\n");

  return lines.join("\n");
}

interface Operation {
  operationId: string;
  method: string;
  path: string;
  pathParams: Array<{ name: string; description?: string }>;
  queryParams: Array<{
    name: string;
    required: boolean;
    schema: SchemaObject;
    description?: string;
  }>;
  bodyParam: {
    name: string;
    schema: SchemaObject;
    propertyDescriptions?: Record<string, string>;
  } | null;
  responseType: string;
  producesBlob: boolean;
  summary?: string;
  description?: string;
}

function extractOperations(
  paths: Record<string, PathItem>,
  definitions: Record<string, SchemaObject>,
): Operation[] {
  const ops: Operation[] = [];
  const methods = ["get", "post", "put", "patch", "delete"] as const;

  for (const [path, pathItem] of Object.entries(paths)) {
    const fullPath = path.startsWith("/") ? path : `/${path}`;

    for (const method of methods) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | {
            operationId?: string;
            summary?: string;
            description?: string;
            parameters?: Array<{
              name: string;
              in: string;
              required?: boolean;
              description?: string;
              schema?: SchemaObject;
            }>;
            responses?: Record<string, { schema?: SchemaObject }>;
            tags?: string[];
          }
        | undefined;

      if (!op?.operationId) continue;

      const pathParamsMap = new Map<string, string>();
      const queryParams: Array<{
        name: string;
        required: boolean;
        schema: SchemaObject;
        description?: string;
      }> = [];
      let bodyParam: {
        name: string;
        schema: SchemaObject;
        propertyDescriptions?: Record<string, string>;
      } | null = null;

      const pathParamNames = [...(path.match(/\{([^}]+)\}/g) ?? [])].map((m) =>
        m.slice(1, -1),
      );
      const allParams = [
        ...(pathItem.parameters ?? []),
        ...(op.parameters ?? []),
      ] as Array<{
        name: string;
        in: string;
        required?: boolean;
        description?: string;
        schema?: SchemaObject;
        type?: string;
      }>;

      for (const p of allParams) {
        if (p.in === "path") {
          if (!pathParamsMap.has(p.name)) {
            pathParamsMap.set(p.name, p.description ?? "");
          }
        }
      }
      for (const name of pathParamNames) {
        if (!pathParamsMap.has(name)) pathParamsMap.set(name, "");
      }
      const pathParams = Array.from(pathParamsMap.entries()).map(
        ([name, description]) => ({
          name,
          description: description || undefined,
        }),
      );

      for (const p of allParams) {
        if (p.in === "path") continue;
        if (p.in === "query") {
          queryParams.push({
            name: p.name,
            required: p.required ?? false,
            schema: (p.schema ?? {
              type: (p as { type?: string }).type ?? "string",
            }) as SchemaObject,
            description: p.description,
          });
        } else if (p.in === "body") {
          const bodySchema = (p.schema ?? { type: "object" }) as SchemaObject;
          const propertyDescriptions: Record<string, string> = {};
          if (bodySchema.properties) {
            for (const [propName, propSchema] of Object.entries(
              bodySchema.properties,
            )) {
              const desc =
                (propSchema as { description?: string; title?: string })
                  .description ??
                (propSchema as { description?: string; title?: string }).title;
              if (desc) propertyDescriptions[propName] = desc;
            }
          }
          bodyParam = {
            name: p.name,
            schema: bodySchema,
            propertyDescriptions:
              Object.keys(propertyDescriptions).length > 0
                ? propertyDescriptions
                : undefined,
          };
        }
      }

      const successResponse = op.responses?.["200"] ?? op.responses?.["201"];
      const respSchema = successResponse?.schema as SchemaObject | undefined;
      const respDesc =
        (successResponse as { description?: string })?.description ?? "";
      const xResponseType = (
        successResponse as { "x-response-type"?: string }
      )?.["x-response-type"];
      let responseType = "unknown";
      if (respSchema) {
        responseType = schemaToTsType(respSchema, definitions);
      }

      const producesBlob =
        xResponseType === "blob" ||
        /File CSV|File.*CSV|Scarica|download|export|blob|binary/i.test(
          respDesc,
        ) ||
        /\/download\/|\/export\/|download-unassigned|generate-csv|import_csv|import_csv\/|download-icon/i.test(
          fullPath,
        );

      ops.push({
        operationId: op.operationId,
        method,
        path: fullPath,
        pathParams,
        queryParams,
        bodyParam,
        responseType: producesBlob ? "Blob" : responseType,
        producesBlob,
        summary: op.summary,
        description: op.description,
      });
    }
  }

  return ops;
}

function groupByTag(
  ops: Operation[],
  paths: Record<string, PathItem>,
): Map<string, Operation[]> {
  const byTag = new Map<string, Operation[]>();

  for (const op of ops) {
    let tag = "default";
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const m of ["get", "post", "put", "patch", "delete"] as const) {
        const o = (pathItem as Record<string, unknown>)[m] as
          | { operationId?: string; tags?: string[] }
          | undefined;
        if (o?.operationId === op.operationId && o.tags?.[0]) {
          tag = o.tags[0];
          break;
        }
      }
    }

    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }

  return byTag;
}

function sanitizeContextName(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Valid JS identifier for context (e.g. building-media -> buildingMedia) */
function contextToIdentifier(tag: string): string {
  return sanitizeIdentifier(sanitizeContextName(tag));
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function operationIdToFunctionName(operationId: string): string {
  const parts = operationId.split("_");
  if (parts.length <= 1) return sanitizeIdentifier(operationId);
  const [context, ...rest] = parts;
  const contextSafe = sanitizeIdentifier(context);
  const action = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
  return contextSafe + action.charAt(0).toUpperCase() + action.slice(1);
}

/** Extract method name from operationId (e.g. allegati_list -> list, allegati_partial_update -> partialUpdate) */
function operationIdToMethodName(operationId: string): string {
  const parts = operationId.split("_");
  if (parts.length <= 1) return sanitizeIdentifier(operationId);
  const [, ...rest] = parts;
  return rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

function sanitizeIdentifier(name: string): string {
  return name
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Escape text for use inside JSDoc (avoid closing comment, handle newlines) */
function jsdocEscape(text: string): string {
  return text.replace(/\*\//g, "* /").replace(/\n/g, " ").trim();
}

function getTagDescription(doc: ParsedSpec, tag: string): string | undefined {
  const tags = (doc as { tags?: Array<{ name: string; description?: string }> })
    .tags;
  return tags?.find((t) => t.name === tag)?.description;
}

function generateContextFile(
  tag: string,
  operations: Operation[],
  definitions: Record<string, SchemaObject>,
  tagDescription?: string,
): string {
  const ctxName = sanitizeContextName(tag);
  const exportName = contextToIdentifier(tag);
  const clientVar = exportName === "client" ? "httpClient" : "client";
  const hasBlobOps = operations.some((o) => o.producesBlob);
  const clientImport =
    exportName === "client"
      ? hasBlobOps
        ? `import { client as httpClient, triggerBlobDownload, type BlobDownloadOptions, type BlobDownloadHeaders } from "../client.js";`
        : `import { client as httpClient } from "../client.js";`
      : hasBlobOps
        ? `import { client, triggerBlobDownload, type BlobDownloadOptions, type BlobDownloadHeaders } from "../client.js";`
        : `import { client } from "../client.js";`;
  const lines: string[] = [
    `// Auto-generated API client for context: ${tag}`,
    "",
    clientImport,
    "",
  ];

  const usedTypes = new Set<string>();
  const builtins = new Set(["Blob", "Array", "Record"]);
  const addUsedType = (t: string) => {
    if (t === "unknown" || builtins.has(t)) return;
    const match = t.match(/^([A-Z][a-zA-Z0-9]*)/);
    if (match && !builtins.has(match[1])) usedTypes.add(match[1]);
    const arrMatch = t.match(/Array<([A-Z][a-zA-Z0-9]*)>/);
    if (arrMatch && !builtins.has(arrMatch[1])) usedTypes.add(arrMatch[1]);
  };
  for (const op of operations) {
    if (op.bodyParam)
      addUsedType(schemaToTsType(op.bodyParam.schema, definitions));
    for (const q of op.queryParams)
      addUsedType(schemaToTsType(q.schema, definitions));
    addUsedType(op.responseType);
  }

  if (usedTypes.size > 0) {
    lines.push(
      `import type { ${[...usedTypes].join(", ")} } from "../types/index.js";`,
    );
    lines.push("");
  }

  const seenNames = new Set<string>();
  const methodEntries: string[] = [];

  for (const op of operations) {
    let methodName = operationIdToMethodName(op.operationId);
    if (seenNames.has(methodName)) {
      let suffix = 1;
      while (seenNames.has(`${methodName}${suffix}`)) suffix++;
      methodName = `${methodName}${suffix}`;
    }
    seenNames.add(methodName);

    const pathParamsType =
      op.pathParams.length > 0
        ? `{ ${op.pathParams.map((p) => `${p.name}: string | number`).join("; ")} }`
        : null;
    const queryParamsType =
      op.queryParams.length > 0
        ? `{ ${op.queryParams.map((q) => `${q.name}${q.required ? "" : "?"}: ${schemaToTsType(q.schema, definitions)}`).join("; ")} }`
        : null;

    const paramsParts: string[] = [];
    if (pathParamsType) paramsParts.push(pathParamsType);
    if (queryParamsType) paramsParts.push(queryParamsType);

    const paramsType =
      paramsParts.length > 0 ? paramsParts.join(" & ") : "void";
    const hasParams = op.pathParams.length > 0 || op.queryParams.length > 0;
    const paramsRequired = op.pathParams.length > 0;
    const paramsArg = hasParams
      ? `params${paramsRequired ? "" : "?"}: ${paramsType}`
      : "";

    const needsBody = op.method !== "get" && op.method !== "delete";
    const bodyArg = op.bodyParam
      ? `data: ${schemaToTsType(op.bodyParam.schema, definitions)}`
      : needsBody
        ? `data?: FormData | Record<string, unknown>`
        : "";
    const optionsArg = op.producesBlob ? `options?: BlobDownloadOptions` : "";
    const args = [paramsArg, bodyArg, optionsArg].filter(Boolean).join(", ");

    let pathExpr = `"${op.path}"`;
    const pathParamNames = op.pathParams.map((p) => p.name);
    if (op.pathParams.length > 0) {
      const repl = op.path.replace(
        /\{([^}]+)\}/g,
        (_, name) => `\${String(params.${name})}`,
      );
      pathExpr = "`" + repl + "`";
    }

    const jsdocParts: string[] = [];
    const summary = op.summary ?? op.description;
    if (summary) {
      jsdocParts.push(jsdocEscape(summary));
      if (op.description && op.description !== op.summary) {
        jsdocParts.push(jsdocEscape(op.description));
      }
    }
    if (op.pathParams.length > 0) {
      for (const p of op.pathParams) {
        const desc = p.description
          ? jsdocEscape(p.description)
          : "Path parameter";
        jsdocParts.push(`@param params.${p.name} - ${desc}`);
      }
    }
    for (const q of op.queryParams) {
      if (q.description) {
        jsdocParts.push(
          `@param params.${q.name} - ${jsdocEscape(q.description)}`,
        );
      } else {
        jsdocParts.push(`@param params.${q.name} - Query parameter`);
      }
    }
    if (op.bodyParam) {
      const bodyDesc = op.bodyParam.propertyDescriptions
        ? Object.entries(op.bodyParam.propertyDescriptions)
            .map(([k, v]) => `${k}: ${jsdocEscape(v)}`)
            .join("; ")
        : "Request body";
      jsdocParts.push(`@param data - ${jsdocEscape(bodyDesc)}`);
    }
    if (op.producesBlob) {
      jsdocParts.push(
        `@param options.download - When true, triggers a file download in the browser`,
      );
      jsdocParts.push(
        `@param options.filename - Suggested filename for the download`,
      );
    }

    const methodLines: string[] = [];
    if (jsdocParts.length > 0) {
      methodLines.push(`    /**`);
      for (const line of jsdocParts) {
        methodLines.push(`     * ${line}`);
      }
      methodLines.push(`     */`);
    }
    methodLines.push(`    async ${methodName}(${args}) {`);

    const http = clientVar;
    if (op.producesBlob) {
      if (op.method === "get" || op.method === "delete") {
        if (op.pathParams.length > 0 && op.queryParams.length > 0) {
          methodLines.push(
            `      const { ${pathParamNames.join(", ")}, ...query } = params ?? {};`,
          );
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, { responseType: "blob", params: query });`,
          );
        } else if (op.pathParams.length > 0) {
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, { responseType: "blob" });`,
          );
        } else if (op.queryParams.length > 0) {
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, { responseType: "blob", params });`,
          );
        } else {
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, { responseType: "blob" });`,
          );
        }
      } else {
        const bodyVal = op.bodyParam || needsBody ? "data" : "undefined";
        if (op.pathParams.length > 0) {
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, ${bodyVal}, { responseType: "blob" });`,
          );
        } else {
          methodLines.push(
            `      const res = await ${http}.${op.method}<Blob>(${pathExpr}, ${bodyVal}, { responseType: "blob" });`,
          );
        }
      }
      methodLines.push(
        `      if (options?.download) triggerBlobDownload(res.data, res.headers as BlobDownloadHeaders, options.filename);`,
      );
      methodLines.push(`      return res;`);
    } else if (op.method === "get" || op.method === "delete") {
      if (op.pathParams.length > 0 && op.queryParams.length > 0) {
        methodLines.push(
          `      const { ${pathParamNames.join(", ")}, ...query } = params;`,
        );
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr}, { params: query });`,
        );
      } else if (op.pathParams.length > 0) {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr});`,
        );
      } else if (op.queryParams.length > 0) {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr}, { params });`,
        );
      } else {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr});`,
        );
      }
    } else {
      const bodyArg = op.bodyParam || needsBody ? ", data" : "";
      if (op.pathParams.length > 0) {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr}${bodyArg});`,
        );
      } else {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr}${bodyArg});`,
        );
      }
    }

    methodLines.push(`    }`);
    methodEntries.push(methodLines.join("\n"));
  }

  const contextDesc = tagDescription
    ? jsdocEscape(tagDescription)
    : `API client for ${tag} endpoints`;
  lines.push(`/** ${contextDesc} */`);
  lines.push(`export const ${exportName} = {`);
  lines.push(methodEntries.join(",\n"));
  lines.push("};");

  return lines.join("\n");
}

function generateClient(baseUrl: string): string {
  return `// Auto-generated Axios client
import axios, { type AxiosInstance } from "axios";

let _token: string | null = null;

export function setAuthToken(token: string | null): void {
  _token = token;
}

export const client: AxiosInstance = axios.create({
  baseURL: "${baseUrl}",
  headers: {
    "Content-Type": "application/json",
  },
});

client.interceptors.request.use((config) => {
  if (_token) {
    config.headers.Authorization = \`Bearer \${_token}\`;
  }
  return config;
});

/** Options for blob/download endpoints */
export interface BlobDownloadOptions {
  /** When true, triggers a file download in the browser */
  download?: boolean;
  /** Suggested filename (falls back to Content-Disposition or default) */
  filename?: string;
}

/** Headers type for blob download (compatible with Axios response headers) */
export type BlobDownloadHeaders =
  | import("axios").AxiosResponseHeaders
  | import("axios").RawAxiosResponseHeaders
  | Record<string, import("axios").AxiosHeaderValue>;

/** Triggers a blob download in the browser. No-op in Node.js. */
export function triggerBlobDownload(
  blob: Blob,
  headers: BlobDownloadHeaders,
  suggestedFilename?: string
): void {
  if (typeof document === "undefined") return;
  const cdRaw = "get" in headers && typeof (headers as import("axios").AxiosHeaders).get === "function"
    ? (headers as import("axios").AxiosHeaders).get("content-disposition")
    : (headers as Record<string, import("axios").AxiosHeaderValue>)["content-disposition"];
  const cd = typeof cdRaw === "string" ? cdRaw : Array.isArray(cdRaw) ? cdRaw[0] : "";
  const filename =
    suggestedFilename ??
    (cd && cd.includes("filename=")
      ? cd.split("filename=")[1]?.replace(/^["']|["']$/g, "").trim()
      : "download");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
`;
}

function generateApiClient(contextTags: string[]): string {
  const entries = contextTags.map((t) => ({
    file: sanitizeContextName(t),
    id: contextToIdentifier(t),
  }));
  const imports = entries
    .map((e) => `import { ${e.id} } from "./contexts/${e.file}.js";`)
    .join("\n");
  const props = entries.map((e) => `  ${e.id}`).join(",\n");
  return `// Auto-generated nested API client
${imports}

export const apiClient = {
${props},
};
`;
}

function generateIndex(contextTags: string[]): string {
  const exports: string[] = [
    'export { client, setAuthToken } from "./client.js";',
    'export { apiClient } from "./apiClient.js";',
    'export * from "./types/index.js";',
    "",
  ];

  const reserved = new Set(["client"]);
  for (const tag of contextTags) {
    const ctxFile = sanitizeContextName(tag);
    const ctxId = contextToIdentifier(tag);
    const exportName = reserved.has(ctxId) ? `${ctxId}Context` : ctxId;
    exports.push(
      `export { ${ctxId} as ${exportName} } from "./contexts/${ctxFile}.js";`,
    );
  }

  return exports.join("\n");
}

interface Manifest {
  docsSource: string;
  docsHash: string;
  clientHash: string;
  out: string;
  generatedAt: string;
}

async function main(): Promise<void> {
  const { url, out, basePath: basePathOverride } = parseArgs();
  console.log(`Fetching spec from ${url}...`);

  const rawSpec = await loadRawSpec(url);
  const doc = await parseSpec(rawSpec);
  const baseUrl = getOrigin(doc);
  const basePath = (() => {
    const raw = basePathOverride ?? "";
    if (raw === "") return "";
    return raw.startsWith("/") ? raw : `/${raw}`;
  })();
  const definitions = getDefinitions(doc);
  const paths = getPaths(doc);

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Base path: ${basePath}`);
  console.log(`Paths: ${Object.keys(paths).length}`);
  console.log(`Definitions: ${Object.keys(definitions).length}`);

  const ops = extractOperations(paths, definitions);
  const byTag = groupByTag(ops, paths);

  const cwd = process.cwd();
  const outDir = join(cwd, out);
  const typesDir = join(outDir, "types");
  const contextsDir = join(outDir, "contexts");

  mkdirSync(typesDir, { recursive: true });
  mkdirSync(contextsDir, { recursive: true });

  const clientBaseUrl = basePath
    ? `${baseUrl.replace(/\/$/, "")}${basePath}`
    : baseUrl;

  writeFileSync(join(typesDir, "index.ts"), generateTypes(definitions));
  writeFileSync(join(outDir, "client.ts"), generateClient(clientBaseUrl));

  const sortedTags = [...byTag.keys()].sort();
  for (const tag of sortedTags) {
    const ctxName = sanitizeContextName(tag);
    const tagDesc = getTagDescription(doc, tag);
    const content = generateContextFile(
      tag,
      byTag.get(tag)!,
      definitions,
      tagDesc,
    );
    writeFileSync(join(contextsDir, `${ctxName}.ts`), content);
  }

  writeFileSync(join(outDir, "apiClient.ts"), generateApiClient(sortedTags));
  writeFileSync(join(outDir, "index.ts"), generateIndex(sortedTags));

  const docsHash = normalizedJsonHash(rawSpec);
  const clientHash = computeClientHash(cwd, out);

  const manifest: Manifest = {
    docsSource: url,
    docsHash,
    clientHash,
    out,
    generatedAt: new Date().toISOString(),
  };

  const manifestPath = join(cwd, "api-client.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Generated API client in ${outDir}`);
  console.log(`  - types/index.ts`);
  console.log(`  - client.ts`);
  console.log(`  - apiClient.ts`);
  console.log(`  - contexts/*.ts (${sortedTags.length} files)`);
  console.log(`  - index.ts`);
  console.log(`  - manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
