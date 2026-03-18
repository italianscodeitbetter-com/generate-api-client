# @icib.dev/api-client

Generator for strictly-typed TypeScript API clients from OpenAPI specs. The client is generated in your project—nothing is published to npm.

## Install

```bash
npm install @icib.dev/api-client axios
```

## Quick Start

1. Generate the client in your project:

```bash
npx api-client-generate
```

2. Import from your generated client:

```typescript
import { setAuthToken, apiClient } from "./api";  // or your --out path

setAuthToken(process.env.API_TOKEN);
const res = await apiClient.allegati.list({ page: 1, size: 10 });
```

3. Add verify to your build (ensures version alignment for production; fails if docs changed or client was modified):

```json
{
  "scripts": {
    "build": "api-client-verify && tsc"
  }
}
```

## API Client Generator

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

# Custom base path (default empty; when set, included in axios baseURL)
npx api-client-generate --base-path /v1/api
BASE_PATH=/v2 npx api-client-generate

# Custom client base URL (default: from spec URL, BASE_URL, or spec host)
npx api-client-generate --base-url https://api.mycompany.com
BASE_URL=https://api.mycompany.com npx api-client-generate
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

Add `api-client-verify` before your build to ensure the generated client matches the current OpenAPI docs. You can insert it in the build step of your utilization library (the app or library that consumes the API client) to verify version alignment before production builds—if the API docs changed or the client was modified, the build fails and you must regenerate.

When you run your build, it:

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
import { apiClient } from "./api";

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
