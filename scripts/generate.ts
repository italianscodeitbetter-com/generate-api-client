#!/usr/bin/env node

import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "fs";
import { createInterface } from "readline";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import SwaggerParser from "@apidevtools/swagger-parser";
import { normalizedJsonHash, computeClientHash } from "./hash.js";
import {
  buildClientTypeScript,
  defaultClientGenOptions,
  indexExportsForAuth,
  type ClientGenOptions,
  type ClientAuthMode,
} from "./generate-client-template.js";

export type { ClientGenOptions, ClientAuthMode } from "./generate-client-template.js";
export { buildClientTypeScript, defaultClientGenOptions } from "./generate-client-template.js";

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
  /** OpenAPI 3.0 */
  nullable?: boolean;
  enum?: unknown[];
  allOf?: SchemaObject[];
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
  format?: string;
  description?: string;
  schema?: SchemaObject;
  items?: SchemaObject;
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
  baseUrl?: string;
  overrideClient: boolean;
  yes: boolean;
  auth: ClientAuthMode;
  jwtInit: "eager" | "lazy";
  jwtAccessStorageKey?: string;
  jwtRefreshStorageKey?: string;
}

function cliArgsToClientGenOptions(args: CliArgs): ClientGenOptions {
  const d = defaultClientGenOptions();
  return {
    auth: args.auth,
    jwtInit: args.jwtInit,
    jwtAccessStorageKey: args.jwtAccessStorageKey ?? d.jwtAccessStorageKey,
    jwtRefreshStorageKey: args.jwtRefreshStorageKey ?? d.jwtRefreshStorageKey,
  };
}

function printGenerateHelp(): void {
  console.log(`Usage: api-client-generate [options]

Generate a typed Axios client and types from an OpenAPI spec.

Options:
  --url <url>              Spec URL or file path (default: from BASE_URL or built-in default)
  --out <dir>              Output directory (default: api)
  --base-path, --basePath <path>   Path prefix merged into axios baseURL (default: BASE_PATH or empty)
  --base-url, --baseUrl <origin>   Override API origin for client baseURL
  --override-client        Overwrite client.ts if it already exists (otherwise left unchanged)
  --yes, -y                With --override-client, skip the confirmation prompt (e.g. for CI)
  --auth <mode>            client.ts auth only: none (default), jwt, cookie, custom
  --jwt-init <when>        With --auth jwt: lazy (default) or eager localStorage read
  --jwt-access-key <key>   With --auth jwt, localStorage key for access (default: accessToken)
  --jwt-refresh-key <key>  With --auth jwt, localStorage key for refresh (default: refreshToken)
  --default-auth           Alias for --auth (deprecated)
  --default-auth-timing    Alias: lazy|immediate maps to --jwt-init lazy|eager (jwt only)
  --help, -h               Show this message

Environment:
  BASE_URL                 Default spec URL and client base URL when not overridden
  BASE_PATH                Default value for --base-path

client.ts contains only the auth logic for the chosen --auth mode. See README.
`);
}

function parseArgs(): CliArgs | null {
  const args = process.argv.slice(2);
  let url = getDefaultUrl();
  let out = DEFAULT_OUT;
  let basePath: string | undefined = process.env.BASE_PATH;
  let baseUrl: string | undefined = process.env.BASE_URL;
  let overrideClient = false;
  let yes = false;
  let auth: ClientAuthMode = "none";
  let jwtInit: "eager" | "lazy" = "lazy";
  let jwtAccessStorageKey: string | undefined;
  let jwtRefreshStorageKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printGenerateHelp();
      return null;
    }
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      out = args[++i];
    } else if (
      (args[i] === "--base-path" || args[i] === "--basePath") &&
      args[i + 1]
    ) {
      basePath = args[++i];
    } else if (
      (args[i] === "--base-url" || args[i] === "--baseUrl") &&
      args[i + 1]
    ) {
      baseUrl = args[++i];
    } else if (args[i] === "--override-client" || args[i] === "--overwrite-client") {
      overrideClient = true;
    } else if (args[i] === "--yes" || args[i] === "-y") {
      yes = true;
    } else if (
      (args[i] === "--auth" || args[i] === "--default-auth") &&
      args[i + 1]
    ) {
      const v = args[++i].toLowerCase();
      if (v !== "none" && v !== "jwt" && v !== "cookie" && v !== "custom") {
        throw new Error(
          `Invalid --auth "${v}". Use none, jwt, cookie, or custom.`,
        );
      }
      auth = v as ClientAuthMode;
    } else if (
      (args[i] === "--jwt-init" ||
        args[i] === "--default-auth-timing" ||
        args[i] === "--default-auth-mode") &&
      args[i + 1]
    ) {
      const v = args[++i].toLowerCase();
      if (v === "immediate") {
        jwtInit = "eager";
      } else if (v === "lazy") {
        jwtInit = "lazy";
      } else if (v === "eager") {
        jwtInit = "eager";
      } else {
        throw new Error(
          `Invalid --jwt-init "${v}". Use lazy, eager, or (deprecated) immediate.`,
        );
      }
    } else if (args[i] === "--jwt-access-key" && args[i + 1]) {
      jwtAccessStorageKey = args[++i];
    } else if (args[i] === "--jwt-refresh-key" && args[i + 1]) {
      jwtRefreshStorageKey = args[++i];
    }
  }

  return {
    url,
    out,
    basePath,
    baseUrl,
    overrideClient,
    yes,
    auth,
    jwtInit,
    jwtAccessStorageKey,
    jwtRefreshStorageKey,
  };
}

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
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

/** Resolve internal JSON pointers (`#/components/...`, `#/parameters/...`). */
function resolveDocPointer(doc: ParsedSpec, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = doc as unknown;
  for (const part of parts) {
    if (cur === undefined || cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * `SwaggerParser.parse` does not resolve `$ref`; OpenAPI often uses
 * `{ "$ref": "#/components/parameters/..." }` in `parameters` arrays. Without
 * resolving those, `in` / `name` are missing and query/path args are dropped.
 */
function dereferenceParameterObject(
  doc: ParsedSpec,
  param: unknown,
  depth = 0,
): ParameterObject | null {
  if (depth > 24 || !param || typeof param !== "object") return null;
  const ref = (param as { $ref?: string }).$ref;
  if (typeof ref === "string") {
    const resolved = resolveDocPointer(doc, ref);
    return dereferenceParameterObject(doc, resolved, depth + 1);
  }
  const p = param as ParameterObject;
  if (typeof p.name === "string" && typeof p.in === "string") return p;
  return null;
}

function expandParameters(
  doc: ParsedSpec,
  list: unknown[] | undefined,
): ParameterObject[] {
  if (!list?.length) return [];
  const out: ParameterObject[] = [];
  for (const item of list) {
    const p = dereferenceParameterObject(doc, item);
    if (p) out.push(p);
  }
  return out;
}

function derefOpenApiFragment(
  doc: ParsedSpec,
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 24 || !value || typeof value !== "object") return value;
  const ref = (value as { $ref?: string }).$ref;
  if (typeof ref === "string") {
    const resolved = resolveDocPointer(doc, ref);
    return derefOpenApiFragment(doc, resolved, depth + 1);
  }
  return value;
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

/** Returns origin only (no basePath) for axios baseURL */
function getOrigin(doc: ParsedSpec): string {
  const oas2 = doc as { host?: string; schemes?: string[] };
  if (oas2.host) {
    const scheme = oas2.schemes?.[0] ?? "https";
    return `${scheme}://${oas2.host}`;
  }
  return "https://api.icib.dev";
}

/** Extract origin (protocol + host) from a URL string */
function getOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function getDefinitions(doc: ParsedSpec): Record<string, SchemaObject> {
  return doc.definitions ?? doc.components?.schemas ?? {};
}

function getPaths(doc: ParsedSpec): Record<string, PathItem> {
  return doc.paths ?? {};
}

/**
 * Extract response schema. Compatible with:
 * - OpenAPI 2.0: response.schema
 * - OpenAPI 3.0: response.content['application/json'].schema
 */
function getResponseSchema(response: unknown): SchemaObject | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as Record<string, unknown>;
  // OpenAPI 2.0: schema directly on response
  if (r.schema && typeof r.schema === "object") {
    return r.schema as SchemaObject;
  }
  // OpenAPI 3.0: schema under content['application/json'] or content['*/*']
  const content = r.content as
    | Record<string, { schema?: SchemaObject }>
    | undefined;
  if (content) {
    const jsonContent =
      content["application/json"] ??
      content["*/*"] ??
      Object.values(content)[0];
    return jsonContent?.schema;
  }
  return undefined;
}

type MultipartFieldKind = "binary" | "arrayBinary" | "primitive";

/**
 * True when `application/json` has no real fields (common placeholder next to multipart).
 * Without this, we would pick JSON and ignore a richer multipart schema.
 */
function isEffectivelyEmptyJsonSchema(schema: SchemaObject | undefined): boolean {
  if (!schema) return true;
  if (schema.$ref) return false;
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) return false;
  if (schema.enum && schema.enum.length > 0) return false;
  if (schema.type === "object" || schema.properties) {
    const props = schema.properties;
    return !props || Object.keys(props).length === 0;
  }
  if (!schema.type && !schema.properties) return true;
  return false;
}

/**
 * Pick request body schema from OpenAPI 3.0 requestBody.content.
 * When both application/json and multipart/form-data exist, prefer multipart if JSON is empty.
 * OpenAPI 2.0 uses parameters with in: "body" or in: "formData" (handled in extractOperations).
 */
function getRequestBodySelection(
  requestBody: unknown,
): { schema: SchemaObject; isMultipart: boolean } | undefined {
  if (!requestBody || typeof requestBody !== "object") return undefined;
  const rb = requestBody as Record<string, unknown>;
  const content = rb.content as
    | Record<string, { schema?: SchemaObject }>
    | undefined;
  if (!content || typeof content !== "object") return undefined;

  const jsonSchema = content["application/json"]?.schema;
  const multipartSchema = content["multipart/form-data"]?.schema;

  if (
    multipartSchema &&
    isEffectivelyEmptyJsonSchema(jsonSchema as SchemaObject | undefined)
  ) {
    return { schema: multipartSchema, isMultipart: true };
  }

  if (jsonSchema) return { schema: jsonSchema, isMultipart: false };

  const starSchema = content["*/*"]?.schema;
  if (starSchema) return { schema: starSchema, isMultipart: false };

  if (multipartSchema) return { schema: multipartSchema, isMultipart: true };

  const first = Object.entries(content).find(
    (entry): entry is [string, { schema: SchemaObject }] => {
      const v = entry[1];
      return Boolean(v && typeof v === "object" && v.schema);
    },
  );
  if (first) {
    const [mime, { schema }] = first;
    return { schema, isMultipart: mime === "multipart/form-data" };
  }
  return undefined;
}

/**
 * Flat multipart body: only top-level object properties. Returns null if shape is unsupported.
 */
/** OpenAPI 2 formData parameter → property schema (type file → binary). */
function parameterSchemaForFormData(
  doc: ParsedSpec,
  p: ParameterObject,
): SchemaObject {
  if (p.schema) {
    return derefOpenApiFragment(doc, p.schema) as SchemaObject;
  }
  const raw = p as { type?: string; format?: string; items?: SchemaObject };
  if (raw.type === "file") {
    return { type: "string", format: "binary" };
  }
  if (raw.type === "array") {
    const items = raw.items
      ? (derefOpenApiFragment(doc, raw.items) as SchemaObject)
      : ({ type: "string" } as SchemaObject);
    return { type: "array", items };
  }
  return {
    type: (raw.type as string) ?? "string",
    ...(raw.format ? { format: raw.format } : {}),
  };
}

function computeMultipartFormFields(
  doc: ParsedSpec,
  schema: SchemaObject | undefined,
): Array<{
  key: string;
  required: boolean;
  kind: MultipartFieldKind;
}> | null {
  if (!schema) return null;
  const resolved = derefOpenApiFragment(doc, schema) as SchemaObject;
  if (!resolved.properties || typeof resolved.properties !== "object") {
    return null;
  }
  const required = new Set(resolved.required ?? []);
  const fields: Array<{
    key: string;
    required: boolean;
    kind: MultipartFieldKind;
  }> = [];

  for (const [key, propSchemaRaw] of Object.entries(resolved.properties)) {
    const prop = derefOpenApiFragment(doc, propSchemaRaw) as SchemaObject;
    if (prop.allOf?.length) return null;
    if (prop.type === "array") {
      const items = derefOpenApiFragment(doc, prop.items) as SchemaObject | undefined;
      if (
        items &&
        items.type === "string" &&
        items.format === "binary" &&
        !items.allOf?.length
      ) {
        fields.push({ key, required: required.has(key), kind: "arrayBinary" });
        continue;
      }
      return null;
    }
    if (
      (prop.type === "string" && prop.format === "binary") ||
      prop.type === "file"
    ) {
      fields.push({ key, required: required.has(key), kind: "binary" });
      continue;
    }
    fields.push({ key, required: required.has(key), kind: "primitive" });
  }
  return fields;
}

function isNullableSchema(schema: SchemaObject): boolean {
  return (
    schema["x-nullable"] === true ||
    schema.nullable === true
  );
}

/** Target name for `#/definitions/X` or `#/components/schemas/X`. */
function referencedSchemaKey(ref: string): string | undefined {
  const m =
    ref.match(/#\/definitions\/(.+)$/) ??
    ref.match(/#\/components\/schemas\/(.+)$/);
  return m?.[1];
}

/** JSON Schema / OpenAPI `enum` → TypeScript union of literals */
function enumToLiteralUnion(values: unknown[]): string {
  return values
    .map((v) => {
      if (v === null) return "null";
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return "unknown";
    })
    .join(" | ");
}

/** e.g. `theme` → Theme, `foo_bar` → FooBar */
function propertyNameToPascalCase(prop: string): string {
  return prop
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function canEmitNamedEnum(values: unknown[]): boolean {
  return values.every(
    (v) => typeof v === "string" || typeof v === "number",
  );
}

/** Unique TS identifier for an enum member; mutates `used`. */
function enumMemberKeyForValue(
  value: string | number,
  used: Set<string>,
): string {
  if (typeof value === "number") {
    const base = `N${String(value).replace(/[^0-9A-Za-z]/g, "_")}`;
    let key = /^[0-9]/.test(base) ? `_${base}` : base;
    let n = 0;
    while (used.has(key)) key = `${base}_${++n}`;
    used.add(key);
    return key;
  }
  let base = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(base)) base = `_${base}`;
  if (!base.replace(/_/g, "")) base = "VALUE";
  let key = base;
  let n = 0;
  while (used.has(key)) key = `${base}_${++n}`;
  used.add(key);
  return key;
}

function formatTsEnumBlock(
  enumName: string,
  values: unknown[],
  description?: string,
): string {
  const usedMembers = new Set<string>();
  const lines: string[] = [];
  if (description) lines.push(`/** ${jsdocEscape(description)} */`);
  lines.push(`export enum ${enumName} {`);
  for (const v of values) {
    if (typeof v === "string") {
      const mem = enumMemberKeyForValue(v, usedMembers);
      lines.push(`  ${mem} = ${JSON.stringify(v)},`);
    } else if (typeof v === "number") {
      const mem = enumMemberKeyForValue(v, usedMembers);
      lines.push(`  ${mem} = ${v},`);
    }
  }
  lines.push("}\n");
  return lines.join("\n");
}

/** Collects `export enum` blocks for inline property enums: `{Root}{Path}Enum`. */
interface InlineEnumEmitContext {
  rootSchemaName: string;
  propertyPath: string[];
  preamble: string[];
  emittedEnumNames: Set<string>;
}

function buildInlineEnumName(ctx: InlineEnumEmitContext): string {
  const root = sanitizeIdentifier(ctx.rootSchemaName);
  const pathPart = ctx.propertyPath
    .map((seg) => propertyNameToPascalCase(seg))
    .join("");
  return `${root}${pathPart}Enum`;
}

function schemaToTsType(
  schema: SchemaObject | undefined,
  definitions: Record<string, SchemaObject>,
  refsSeen: Set<string> = new Set(),
  inlineEnumCtx?: InlineEnumEmitContext,
): string {
  if (!schema) return "unknown";

  const ref = schema.$ref;
  if (typeof ref === "string") {
    const name = referencedSchemaKey(ref);
    if (!name || !(name in definitions)) {
      return "unknown";
    }
    if (!refsSeen.has(name)) {
      refsSeen.add(name);
      const inner = name;
      return isNullableSchema(schema) ? `${inner} | null` : inner;
    }
    const inner = name;
    return isNullableSchema(schema) ? `${inner} | null` : inner;
  }

  const nullable = isNullableSchema(schema);

  const allOf = schema.allOf;
  if (Array.isArray(allOf) && allOf.length > 0) {
    const types = allOf.map((sub) =>
      schemaToTsType(sub, definitions, refsSeen, inlineEnumCtx),
    );
    const inner =
      types.length === 1 ? types[0]! : types.map((t) => `(${t})`).join(" & ");
    return nullable ? `${inner} | null` : inner;
  }

  const enumVals = schema.enum;
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    if (inlineEnumCtx && canEmitNamedEnum(enumVals)) {
      const enumName = buildInlineEnumName(inlineEnumCtx);
      if (!inlineEnumCtx.emittedEnumNames.has(enumName)) {
        inlineEnumCtx.emittedEnumNames.add(enumName);
        inlineEnumCtx.preamble.push(
          formatTsEnumBlock(
            enumName,
            enumVals,
            schema.description ?? schema.title,
          ),
        );
      }
      const inner = enumName;
      return nullable ? `${inner} | null` : inner;
    }
    const inner = enumToLiteralUnion(enumVals);
    return nullable ? `${inner} | null` : inner;
  }

  if (schema.type === "array") {
    const items = schema.items;
    const itemCtx = inlineEnumCtx
      ? {
          ...inlineEnumCtx,
          propertyPath: [...inlineEnumCtx.propertyPath, "item"],
        }
      : undefined;
    const itemType = schemaToTsType(items, definitions, refsSeen, itemCtx);
    const arr = `Array<${itemType}>`;
    return nullable ? `${arr} | null` : arr;
  }

  if (schema.type === "object") {
    if (schema.properties) {
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const propSchema = v as SchemaObject;
        const optional = !(schema.required ?? []).includes(k);
        const childCtx = inlineEnumCtx
          ? {
              ...inlineEnumCtx,
              propertyPath: [...inlineEnumCtx.propertyPath, k],
            }
          : undefined;
        const t = schemaToTsType(propSchema, definitions, refsSeen, childCtx);
        return `  ${k}${optional ? "?" : ""}: ${t};`;
      });
      const obj = `{\n${props.join("\n")}\n}`;
      return nullable ? `${obj} | null` : obj;
    }
    const rec = "Record<string, unknown>";
    return nullable ? `${rec} | null` : rec;
  }

  const prim: Record<string, string> = {
    string: "string",
    integer: "number",
    number: "number",
    boolean: "boolean",
  };
  let t = prim[schema.type as string] ?? "unknown";
  if (schema.format === "binary") t = "Blob | File";
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

    const enumVals = s.enum;
    if (
      Array.isArray(enumVals) &&
      enumVals.length > 0 &&
      !s.properties &&
      s.type !== "object"
    ) {
      const ifaceDesc = s.description ?? s.title;
      if (canEmitNamedEnum(enumVals)) {
        const enumName = sanitizeIdentifier(name);
        lines.push(formatTsEnumBlock(enumName, enumVals, ifaceDesc));
      } else {
        if (ifaceDesc) lines.push(`/** ${jsdocEscape(ifaceDesc)} */`);
        const union = enumToLiteralUnion(enumVals);
        const nullable = isNullableSchema(s);
        lines.push(
          `export type ${sanitizeIdentifier(name)} = ${nullable ? `${union} | null` : union};\n`,
        );
      }
      continue;
    }

    const props: string[] = [];
    const sharedRefsSeen = new Set<string>();
    const inlineEnumEmitter: InlineEnumEmitContext = {
      rootSchemaName: name,
      propertyPath: [],
      preamble: [],
      emittedEnumNames: new Set(),
    };
    if (s.properties) {
      const required = new Set(s.required ?? []);
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        const optional = !required.has(propName);
        const t = schemaToTsType(
          propSchema as SchemaObject,
          definitions,
          sharedRefsSeen,
          {
            ...inlineEnumEmitter,
            propertyPath: [propName],
          },
        );
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
      if (inlineEnumEmitter.preamble.length > 0) {
        lines.push(inlineEnumEmitter.preamble.join(""));
      }
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
  /** From OpenAPI requestBody.required (OAS 3) or body parameter required (OAS 2). */
  bodyRequired: boolean;
  /** OpenAPI 3 multipart/form-data body (when JSON is not chosen for the same operation). */
  isMultipart: boolean;
  /** When set, method builds FormData from typed `data` using these keys. */
  multipartFormFields?: Array<{
    key: string;
    required: boolean;
    kind: MultipartFieldKind;
  }>;
  responseType: string;
  producesBlob: boolean;
  summary?: string;
  description?: string;
}

function extractOperations(
  paths: Record<string, PathItem>,
  definitions: Record<string, SchemaObject>,
  doc: ParsedSpec,
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
            requestBody?: unknown;
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
      let bodyRequired = false;

      const pathParamNames = [...(path.match(/\{([^}]+)\}/g) ?? [])].map((m) =>
        m.slice(1, -1),
      );
      const pathItemParams = (pathItem as { parameters?: unknown[] })
        .parameters;
      const allParams = [
        ...expandParameters(doc, pathItemParams),
        ...expandParameters(doc, op.parameters as unknown[] | undefined),
      ];

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

      const formDataParams: ParameterObject[] = [];

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
        } else if (p.in === "formData") {
          formDataParams.push(p);
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
          bodyRequired = p.required === true;
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

      let isMultipart = false;
      let multipartFormFields: Operation["multipartFormFields"];

      // OpenAPI 2.0: multipart fields as parameters with in: "formData"
      if (!bodyParam && formDataParams.length > 0) {
        const properties: Record<string, SchemaObject> = {};
        const requiredNames: string[] = [];
        const propertyDescriptions: Record<string, string> = {};
        for (const fp of formDataParams) {
          properties[fp.name] = parameterSchemaForFormData(doc, fp);
          if (fp.required === true) requiredNames.push(fp.name);
          if (fp.description) propertyDescriptions[fp.name] = fp.description;
        }
        const bodySchema: SchemaObject = {
          type: "object",
          properties,
          ...(requiredNames.length > 0 ? { required: requiredNames } : {}),
        };
        bodyRequired = formDataParams.some((p) => p.required === true);
        bodyParam = {
          name: "data",
          schema: bodySchema,
          propertyDescriptions:
            Object.keys(propertyDescriptions).length > 0
              ? propertyDescriptions
              : undefined,
        };
        isMultipart = true;
        const plan = computeMultipartFormFields(doc, bodySchema);
        if (plan && plan.length > 0) multipartFormFields = plan;
      }

      // OpenAPI 3.0: body in requestBody (OAS 2.0 uses parameters in: "body" above)
      if (!bodyParam && op.requestBody) {
        const resolvedBody = derefOpenApiFragment(doc, op.requestBody);
        const selection = getRequestBodySelection(resolvedBody);
        if (selection) {
          const bodySchema = selection.schema;
          isMultipart = selection.isMultipart;
          if (isMultipart) {
            const plan = computeMultipartFormFields(doc, bodySchema);
            if (plan && plan.length > 0) multipartFormFields = plan;
          }
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
          bodyRequired =
            (resolvedBody as { required?: boolean }).required === true;
          bodyParam = {
            name: "data",
            schema: bodySchema,
            propertyDescriptions:
              Object.keys(propertyDescriptions).length > 0
                ? propertyDescriptions
                : undefined,
          };
        }
      }

      const successResponse = op.responses?.["200"] ?? op.responses?.["201"];
      const respSchema = getResponseSchema(successResponse);
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
        bodyRequired,
        isMultipart,
        multipartFormFields,
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
  const actionRaw = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
  const action = sanitizeIdentifier(actionRaw);
  return contextSafe + action.charAt(0).toUpperCase() + action.slice(1);
}

/**
 * Extract method name from operationId (e.g. allegati_list -> list, allegati_partial_update -> partialUpdate).
 * Segments may contain hyphens (e.g. building-registry-models_read); those must become camelCase or the
 * emitted name is not a valid JS identifier.
 */
function operationIdToMethodName(operationId: string): string {
  const parts = operationId.split("_");
  if (parts.length <= 1) return sanitizeIdentifier(operationId);
  const [, ...rest] = parts;
  const raw = rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
  return sanitizeIdentifier(raw);
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

function emitMultipartFormDataBuild(
  fields: NonNullable<Operation["multipartFormFields"]>,
): string[] {
  const lines: string[] = [`      const _formData = new FormData();`];
  const dk = (k: string) => `data[${JSON.stringify(k)}]`;
  for (const f of fields) {
    if (f.kind === "arrayBinary") {
      lines.push(`      for (const _item of ${dk(f.key)} ?? []) {`);
      lines.push(
        `        _formData.append(${JSON.stringify(f.key)}, _item);`,
      );
      lines.push(`      }`);
    } else if (f.kind === "binary") {
      if (f.required) {
        lines.push(
          `      _formData.append(${JSON.stringify(f.key)}, ${dk(f.key)});`,
        );
      } else {
        lines.push(
          `      if (${dk(f.key)} !== undefined && ${dk(f.key)} !== null) _formData.append(${JSON.stringify(f.key)}, ${dk(f.key)});`,
        );
      }
    } else if (f.required) {
      lines.push(
        `      _formData.append(${JSON.stringify(f.key)}, String(${dk(f.key)}));`,
      );
    } else {
      lines.push(
        `      if (${dk(f.key)} !== undefined && ${dk(f.key)} !== null) _formData.append(${JSON.stringify(f.key)}, String(${dk(f.key)}));`,
      );
    }
  }
  return lines;
}

/** Use axios *Form aliases when the body is multipart/form-data (FormData). */
function axiosMultipartMethod(httpMethod: string): string {
  switch (httpMethod) {
    case "post":
      return "postForm";
    case "put":
      return "putForm";
    case "patch":
      return "patchForm";
    default:
      return httpMethod;
  }
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
        ? `import { client as httpClient, triggerBlobDownload, ensureBlobAxiosResponse, type BlobDownloadOptions, type BlobDownloadHeaders } from "../client.js";`
        : `import { client as httpClient } from "../client.js";`
      : hasBlobOps
        ? `import { client, triggerBlobDownload, ensureBlobAxiosResponse, type BlobDownloadOptions, type BlobDownloadHeaders } from "../client.js";`
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

    const includeDataInArgs =
      Boolean(op.bodyParam) ||
      (op.method !== "get" && op.method !== "delete");
    const multipartAuto = Boolean(
      op.bodyParam && op.isMultipart && op.multipartFormFields?.length,
    );

    const argsObjectProps: string[] = [];
    if (op.pathParams.length > 0) {
      argsObjectProps.push(
        `params: { ${op.pathParams.map((p) => `${p.name}: string | number`).join("; ")} }`,
      );
    }
    if (op.queryParams.length > 0) {
      const queryInner = op.queryParams
        .map(
          (q) =>
            `${q.name}${q.required ? "" : "?"}: ${schemaToTsType(q.schema, definitions)}`,
        )
        .join("; ");
      const queryKey = op.queryParams.some((q) => q.required)
        ? "query"
        : "query?";
      argsObjectProps.push(`${queryKey}: { ${queryInner} }`);
    }
    if (includeDataInArgs) {
      let dataProp: string;
      if (op.bodyParam) {
        const bodyTs = multipartAuto
          ? schemaToTsType(op.bodyParam.schema, definitions)
          : op.isMultipart
            ? "FormData"
            : schemaToTsType(op.bodyParam.schema, definitions);
        dataProp = op.bodyRequired
          ? `data: ${bodyTs}`
          : `data?: ${bodyTs} | null`;
      } else {
        dataProp = `data?: FormData | Record<string, unknown> | null`;
      }
      argsObjectProps.push(dataProp);
    }

    const hasArgsObject = argsObjectProps.length > 0;
    const argsObjectRequired =
      op.pathParams.length > 0 ||
      op.queryParams.some((q) => q.required) ||
      (Boolean(op.bodyParam) && op.bodyRequired);

    const optionsArg = op.producesBlob ? `options?: BlobDownloadOptions` : "";
    const methodParams = [
      hasArgsObject
        ? `${argsObjectRequired ? "args" : "args?"}: { ${argsObjectProps.join("; ")} }`
        : "",
      optionsArg,
    ]
      .filter(Boolean)
      .join(", ");

    let pathExpr = `"${op.path}"`;
    if (op.pathParams.length > 0) {
      const repl = op.path.replace(
        /\{([^}]+)\}/g,
        (_, name) => `\${String(params.${name})}`,
      );
      pathExpr = "`" + repl + "`";
    }

    const hasQuery = op.queryParams.length > 0;
    const isReadMethod = op.method === "get" || op.method === "delete";

    const jsdocParts: string[] = [];
    const summary = op.summary ?? op.description;
    if (summary) {
      jsdocParts.push(jsdocEscape(summary));
      if (op.description && op.description !== op.summary) {
        jsdocParts.push(jsdocEscape(op.description));
      }
    }
    for (const p of op.pathParams) {
      const desc = p.description
        ? jsdocEscape(p.description)
        : "Path parameter";
      jsdocParts.push(`@param args.params.${p.name} - ${desc}`);
    }
    for (const q of op.queryParams) {
      if (q.description) {
        jsdocParts.push(
          `@param args.query.${q.name} - ${jsdocEscape(q.description)}`,
        );
      } else {
        jsdocParts.push(`@param args.query.${q.name} - Query parameter`);
      }
    }
    if (op.bodyParam) {
      const bodyDesc = op.bodyParam.propertyDescriptions
        ? Object.entries(op.bodyParam.propertyDescriptions)
            .map(([k, v]) => `${k}: ${jsdocEscape(v)}`)
            .join("; ")
        : "Request body";
      jsdocParts.push(`@param args.data - ${jsdocEscape(bodyDesc)}`);
    } else if (includeDataInArgs) {
      jsdocParts.push(
        `@param args.data - Request body (optional when the operation has no schema; may be null)`,
      );
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
    methodLines.push(`    async ${methodName}(${methodParams}) {`);

    if (hasArgsObject) {
      const destructureKeys: string[] = [];
      if (op.pathParams.length > 0) destructureKeys.push("params");
      if (op.queryParams.length > 0) destructureKeys.push("query");
      if (includeDataInArgs) destructureKeys.push("data");
      const rhs = argsObjectRequired ? "args" : "args ?? {}";
      methodLines.push(
        `      const { ${destructureKeys.join(", ")} } = ${rhs};`,
      );
    }

    if (multipartAuto) {
      methodLines.push(
        ...emitMultipartFormDataBuild(op.multipartFormFields!),
      );
    }

    const http = clientVar;
    const blobConfig = hasQuery
      ? `{ responseType: "blob", params: query }`
      : `{ responseType: "blob" }`;

    const mutatingBodyVal = multipartAuto
      ? "_formData"
      : includeDataInArgs
        ? "data"
        : "undefined";

    const mutatingHttpMethod = op.isMultipart
      ? axiosMultipartMethod(op.method)
      : op.method;

    if (op.producesBlob) {
      if (isReadMethod) {
        methodLines.push(
          `      const _raw = await ${http}.${op.method}<Blob>(${pathExpr}, ${blobConfig});`,
        );
      } else {
        methodLines.push(
          `      const _raw = await ${http}.${mutatingHttpMethod}<Blob>(${pathExpr}, ${mutatingBodyVal}, ${blobConfig});`,
        );
      }
      methodLines.push(`      const res = ensureBlobAxiosResponse(_raw);`);
      methodLines.push(
        `      if (options?.download) triggerBlobDownload(res.data, res.headers as BlobDownloadHeaders, options.filename);`,
      );
      methodLines.push(`      return res;`);
    } else if (isReadMethod) {
      if (hasQuery) {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr}, { params: query });`,
        );
      } else {
        methodLines.push(
          `      return ${http}.${op.method}<${op.responseType}>(${pathExpr});`,
        );
      }
    } else if (hasQuery) {
      methodLines.push(
        `      return ${http}.${mutatingHttpMethod}<${op.responseType}>(${pathExpr}, ${mutatingBodyVal}, { params: query });`,
      );
    } else {
      methodLines.push(
        `      return ${http}.${mutatingHttpMethod}<${op.responseType}>(${pathExpr}, ${mutatingBodyVal});`,
      );
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


export function generateClient(
  baseUrl: string,
  partial?: Partial<ClientGenOptions>,
): string {
  const o = { ...defaultClientGenOptions(), ...partial };
  return buildClientTypeScript(baseUrl, o);
}

const API_CLIENT_CUSTOM_FILENAME = "apiClient.custom.ts";

function generateApiClientCustomScaffold(): string {
  return `// Customize the generated apiClient (overrides, bypasses). This file is not overwritten by the generator.

export function augmentApiClient<T>(base: T): T {
  return base;
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
import { augmentApiClient } from "./apiClient.custom.js";

const _generatedApiClient = {
${props},
};

export type GeneratedApiClient = typeof _generatedApiClient;

export const apiClient = augmentApiClient(_generatedApiClient);
`;
}

function generateIndex(contextTags: string[], auth: ClientAuthMode): string {
  const { clientExports, typeExports } = indexExportsForAuth(auth);
  const exports: string[] = [
    clientExports,
    typeExports,
    'export { apiClient } from "./apiClient.js";',
    'export type { GeneratedApiClient } from "./apiClient.js";',
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
  const parsed = parseArgs();
  if (!parsed) return;
  const {
    url,
    out,
    basePath: basePathOverride,
    baseUrl: baseUrlOverride,
    overrideClient,
    yes,
    auth,
    jwtInit,
    jwtAccessStorageKey,
    jwtRefreshStorageKey,
  } = parsed;

  const clientGenOptions = cliArgsToClientGenOptions(parsed);

  console.log(`Fetching spec from ${url}...`);

  const rawSpec = await loadRawSpec(url);
  const doc = await parseSpec(rawSpec);
  const baseUrl = (() => {
    const override = baseUrlOverride ?? process.env.BASE_URL;
    if (override)
      return getOriginFromUrl(override) ?? override.replace(/\/$/, "");
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return getOriginFromUrl(url) ?? getOrigin(doc);
    }
    return getOrigin(doc);
  })();
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

  const ops = extractOperations(paths, definitions, doc);
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

  const clientPath = join(outDir, "client.ts");
  const clientExists = existsSync(clientPath);
  let writeClient = !clientExists;
  if (clientExists) {
    if (overrideClient) {
      if (yes) {
        writeClient = true;
      } else {
        const confirmed = await askConfirmation(
          "This will overwrite your client.ts. Are you sure? (y/N) ",
        );
        writeClient = confirmed;
      }
    }
  }
  if (writeClient) {
    writeFileSync(clientPath, generateClient(clientBaseUrl, clientGenOptions));
  }

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

  const apiClientCustomPath = join(outDir, API_CLIENT_CUSTOM_FILENAME);
  const apiClientCustomExisted = existsSync(apiClientCustomPath);
  if (!apiClientCustomExisted) {
    writeFileSync(apiClientCustomPath, generateApiClientCustomScaffold());
  }

  writeFileSync(join(outDir, "apiClient.ts"), generateApiClient(sortedTags));
  writeFileSync(join(outDir, "index.ts"), generateIndex(sortedTags, auth));

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
  console.log(
    `  - client.ts${writeClient ? "" : " (skipped, use --override-client to overwrite)"}${
      writeClient ? ` (--auth ${auth}${auth === "jwt" ? `, ${jwtInit}` : ""})` : ""
    }`,
  );
  console.log(`  - apiClient.ts`);
  console.log(
    `  - ${API_CLIENT_CUSTOM_FILENAME}${apiClientCustomExisted ? " (left unchanged)" : " (created)"}`,
  );
  console.log(`  - contexts/*.ts (${sortedTags.length} files)`);
  console.log(`  - index.ts`);
  console.log(`  - manifest: ${manifestPath}`);
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
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
