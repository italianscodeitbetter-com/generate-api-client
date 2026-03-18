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

## API Client Generator (for maintainers)

To regenerate the client from the OpenAPI spec:

```bash
npm run generate
```

With options:

```bash
npm run generate -- --url https://api.icib.dev/docs/?format=openapi --out api
```

### Output

The generator creates an `api/` folder:

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

## Publishing

To publish to npm under the `@icib.dev` scope:

1. Ensure you're logged in: `npm login`
2. Create the org if needed: `npm org create icib.dev` (or add your user to it)
3. Publish: `npm publish --access public`

The `prepublishOnly` script will automatically run `generate` and `build` before publishing.
