# @icib.dev/api-client

Strictly-typed TypeScript API client for the ICIB API, built with Axios and organized by context (tags).

## Install

```bash
npm install @icib.dev/api-client
```

## Quick Start

```typescript
import { setAuthToken, apiClient } from "@icib.dev/api-client";

// Set your auth token (e.g. from env)
setAuthToken(process.env.API_TOKEN);

// Use the API - fully typed!
const res = await apiClient.allegati.list({ page: 1, size: 10 });
const detail = await apiClient.allegati.read({ id: res.data.results[0].id });
```

## API Client Generator

To regenerate the client from the OpenAPI spec.

### From consuming apps (npx)

If you use this library in your app, run the generator from your project root:

```bash
npx api-client-generate
```

With options:

```bash
# Custom URL
npx api-client-generate --url https://api.example.com/docs/openapi --out api

# Using BASE_URL env (default: $BASE_URL/docs/openapi)
BASE_URL=https://api.example.com npx api-client-generate --out api

# Custom base path (overrides spec; default from spec or empty)
npx api-client-generate --base-path /v1/api
BASE_PATH=/v2 npx api-client-generate
```

The client is generated in your project directory (e.g. `./api/`).

### From the library repo (maintainers)

```bash
npm run generate
```

By default, the spec URL is `$BASE_URL/docs/openapi` when the `BASE_URL` env variable is set. If unset, it falls back to the ICIB default.

### Output

The generator creates an `api/` folder and a local manifest (`api-client.manifest.json`, gitignored):

```
api/
├── client.ts          # Axios instance with Bearer auth
├── types/index.ts     # TypeScript interfaces from schema definitions
├── contexts/          # One file per API context (tag)
│   ├── allegati.ts
│   ├── articolo.ts
│   └── ...
└── index.ts           # Re-exports all contexts and types
```

### Hash verification

The build verifies that the generated client matches the current OpenAPI docs. When you run `npm run build`, it:

1. Reads the manifest (created by `generate`)
2. Fetches the current docs and compares their hash
3. Hashes the generated client files and compares with the manifest

**If docs changed:** Build fails with:
> API docs have changed. Run `npm run generate` to regenerate the client, then update your application.

**If client was manually edited:** Build fails with:
> Generated client files were modified. Run `npm run generate` to regenerate.

**If manifest is missing:** Run `npm run generate` first (e.g. after a fresh clone).

### JSDoc documentation

The generated client includes JSDoc comments from the OpenAPI spec:

- **Context/controller**: Description from tag or "API client for X endpoints"
- **Methods**: Operation `summary` and `description`
- **Params**: `@param` with descriptions for path params, query params, and body
- **Types**: Interface and property descriptions when present in the schema

### Blob / file download endpoints

Endpoints that return files (CSV, PDF, etc.) are detected from the spec (description, path patterns like `/download/`, `x-response-type: blob`). They return `Blob` and support `download: true` to trigger a browser download:

```typescript
import { apiClient } from "@icib.dev/api-client";

// Get blob in response.data
const res = await apiClient.QR_Code.downloadUnassigned({ page: 1, size: 100 });
const csvBlob = res.data; // Blob

// Auto-download in browser
await apiClient.QR_Code.downloadUnassigned({}, { download: true });
await apiClient.QR_Code.generateCsv(
  { n: 10 },
  { download: true, filename: "qrcodes.csv" },
);
```
