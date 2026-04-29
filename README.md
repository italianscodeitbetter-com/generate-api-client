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

For JWT + `localStorage`, generate with **`--auth jwt`** (see **Authentication**).

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

# Override client.ts (by default, existing client is preserved if you customized it)
npx api-client-generate --override-client   # prompts for confirmation
npx api-client-generate --override-client --yes   # skip confirmation (e.g. CI)

# client.ts includes only the auth mode you choose (see table below)
npx api-client-generate --auth jwt --jwt-init lazy --override-client --yes
npx api-client-generate --auth jwt --jwt-init eager --jwt-access-key myAccess --jwt-refresh-key myRefresh --override-client --yes
npx api-client-generate --auth cookie --override-client --yes
npx api-client-generate --auth custom --override-client --yes

# CLI reference
npx api-client-generate --help
npx api-client-verify --help
```

The client is generated in your project directory (e.g. `./api/`). If `client.ts` already exists, it is **not** overwritten unless you pass `--override-client` (which prompts for confirmation; use `--yes` to skip the prompt).

**Auth mode (`--auth`)**

`client.ts` is generated with **only** the matching implementation (no `configureAuth`, `setDefaultAuthProfile`, or unused profiles).

| Flag | Generated behavior |
|------|-------------------|
| **`--auth none`** (default) | Bearer from **`setAuthToken`** in memory; optional object form for access + refresh; no `localStorage`. |
| **`--auth jwt`** | Same Bearer + persist access/refresh in `localStorage`. **`--jwt-init lazy`** (default): read storage on the **first** HTTP request. **`--jwt-init eager`**: read when the module loads. Keys: **`--jwt-access-key`**, **`--jwt-refresh-key`** (defaults `accessToken` / `refreshToken`). |
| **`--auth cookie`** | `withCredentials: true`; no Bearer header; token helpers are no-ops for headers. |
| **`--auth custom`** | Bearer + empty **`applyRequestAuth`** in `client.ts` — edit it for API keys, etc. |

**Aliases:** **`--default-auth`** → **`--auth`**; **`--default-auth-timing immediate`** → **`--jwt-init eager`**; **`lazy`** → **`--jwt-init lazy`**.

You still register **`setAuthRefreshHandler`** in your app (refresh URLs are not in the OpenAPI spec). Use **`--override-client`** when regenerating so `client.ts` matches your chosen **`--auth`**.

### From the library repo (maintainers)

```bash
npm run generate
```

By default, the spec URL is `$BASE_URL/docs/openapi` when the `BASE_URL` env variable is set. If unset, it falls back to the ICIB default.

### Output

The generator creates an `api/` folder and a local manifest (`api-client.manifest.json`, gitignored):

```
api/
├── client.ts              # Axios instance + single auth mode + optional token refresh
├── apiClient.ts           # Nested apiClient (generated; imports apiClient.custom.ts)
├── apiClient.custom.ts    # augmentApiClient hook — created if missing, never overwritten
├── types/index.ts         # TypeScript interfaces from schema definitions
├── contexts/              # One file per API context (tag)
│   ├── allegati.ts
│   ├── articolo.ts
│   └── ...
└── index.ts               # Re-exports client, apiClient, types, contexts
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

### Extending `apiClient` (`apiClient.custom.ts`)

The generator writes **`apiClient.ts`** as a thin wrapper: it builds **`_generatedApiClient`**, exports the type **`GeneratedApiClient`**, and assigns **`apiClient = augmentApiClient(_generatedApiClient)`** from **`./apiClient.custom.ts`**.

- If **`apiClient.custom.ts`** is missing, generate creates it with a default identity **`augmentApiClient<T>(base: T): T`**.
- If it **already exists**, generate **does not overwrite it** (same idea as preserving **`client.ts`**).

Edit **`apiClient.custom.ts`** to override or wrap specific context methods (bypass odd OpenAPI shapes, custom parsing, raw **`client`** calls) without touching regenerated **`contexts/*.ts`**.

When you need the generated client type, use **`import type { GeneratedApiClient } from "./apiClient.js"`** from inside **`apiClient.custom.ts`** — stick to **`import type`** so you do not create a runtime circular dependency between the two modules.

**`api-client-verify`** hashes **`apiClient.custom.ts`** together with the rest of the client output. After you change it, run **`api-client-generate`** again so **`api-client.manifest.json`** picks up the new **`clientHash`**.

The generated **`index.ts`** also re-exports **`GeneratedApiClient`** for use elsewhere in your app.

### Authentication (`client.ts`)

Choose **`--auth`** when you generate so `client.ts` only contains that flow. There is no runtime **`configureAuth`** / **`setDefaultAuthProfile`** — switching modes means regenerating with **`--override-client`**.

**Exports (typical):** `client`, `setAuthToken` (string or `{ accessToken, refreshToken? }`), `setRefreshToken`, `getAuthToken`, `getRefreshToken`, `clearAuthToken`, `setAuthRefreshHandler`, blob helpers.

Successful calls on **`client`** resolve to a full **`AxiosResponse`** (use **`.data`** for the parsed body, **`.headers`** / **`.status`** for debugging).

- **`setAuthRefreshHandler`** — on 401/403, runs your refresh, then **`saveToken`** like `setAuthToken`. Mark the refresh HTTP call with **`skipAuthRefresh: true`** (see `client.ts` JSDoc).
- **`--auth jwt`** + lazy: first request loads tokens from `localStorage` if memory is still empty (then keeps using memory). Eager loads storage when the module loads.
- **`--auth custom`:** edit **`applyRequestAuth`** inside `client.ts` for API keys, etc.

**Example (JWT client + refresh)** — generate with `npx api-client-generate --auth jwt --jwt-init lazy …`:

```typescript
import { apiClient, client, setAuthToken, setAuthRefreshHandler, getRefreshToken } from "./api";

setAuthRefreshHandler(async (saveToken) => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Not logged in");
  const res = await client.post<{
    accessToken: string;
    refreshToken: string;
  }>("/auth/refresh", { refreshToken }, { skipAuthRefresh: true });
  saveToken({
    accessToken: res.data.accessToken,
    refreshToken: res.data.refreshToken,
  });
});

setAuthToken({
  accessToken: loginResponse.accessToken,
  refreshToken: loginResponse.refreshToken,
});

await apiClient.someContext.list({ page: 1, size: 10 });
```

**Nuxt 3:** use a **`.client`** plugin for **`setAuthRefreshHandler`** (and any login that calls **`setAuthToken`**). With **`--auth jwt`**, you do not configure a separate “profile” in Nuxt—`client.ts` is already JWT-only.

### JSDoc documentation

The generated client includes JSDoc comments from the OpenAPI spec:

- **Context/controller**: Description from tag or "API client for X endpoints"
- **Methods**: Operation `summary` and `description`
- **Params**: `@param` with descriptions for path params, query params, and body
- **Types**: Interface and property descriptions when present in the schema

### File uploads (`multipart/form-data`)

OpenAPI 3 operations whose `requestBody` uses **`multipart/form-data`** with a flat object schema are generated to accept a typed **`data`** object and **build `FormData` inside the method** (so axios sends the correct multipart body and boundary). Properties with **`format: binary`** are typed as **`Blob | File`**; other scalar parts are appended as strings. Arrays of binary parts (array of `string` + `format: binary`) are supported as repeated `append` calls.

If the same operation lists **`application/json`** and multipart, the generator **prefers JSON** for the body schema (unchanged behavior). Multipart-only (or multipart when JSON is absent) triggers automatic `FormData`.

If the multipart schema is not a plain object with supported fields (e.g. nested objects, `allOf`, or unsupported array shapes), the method expects **`data: FormData`** and passes it through unchanged.

OpenAPI 2 **`in: formData` / `type: file`** parameters are not handled by this path; use OpenAPI 3 `requestBody` + `multipart/form-data` for uploads.

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
