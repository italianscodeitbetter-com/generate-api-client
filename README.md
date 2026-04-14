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

For browser apps with access + refresh tokens, use **`configureAuth({ kind: "jwt" })`** to apply immediately, or **`setDefaultAuthProfile({ kind: "jwt" })`** so the profile applies on the first API call (see **How to set lazy auth** under Authentication).

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

# Bake default auth into client.ts (no runtime configureAuth / setDefaultAuthProfile call needed)
npx api-client-generate --default-auth jwt --default-auth-timing lazy --override-client --yes
npx api-client-generate --default-auth jwt --default-auth-timing immediate --jwt-access-key myAccess --jwt-refresh-key myRefresh --override-client --yes
npx api-client-generate --default-auth cookie --default-auth-timing lazy --override-client --yes

# CLI reference
npx api-client-generate --help
npx api-client-verify --help
```

The client is generated in your project directory (e.g. `./api/`). If `client.ts` already exists, it is **not** overwritten unless you pass `--override-client` (which prompts for confirmation; use `--yes` to skip the prompt).

**Bake default auth at generate time (`--default-auth`)**

Pass **`--default-auth`** so the generator appends a one-line call at the bottom of `client.ts`:

| Flag | Meaning |
|------|---------|
| **`--default-auth none`** | Default: no extra line (same as today). |
| **`--default-auth jwt`** | Appends `setDefaultAuthProfile({ kind: "jwt", ... })` or `configureAuth(...)` depending on timing. |
| **`--default-auth cookie`** | Cookie session profile. |
| **`--default-auth custom`** | Custom profile without `applyRequestAuth` (Bearer-from-memory only; add hooks by editing `client.ts` or use runtime `configureAuth` once). |
| **`--default-auth-timing lazy`** | Default: **`setDefaultAuthProfile`** runs when the module loads; the profile is applied on the **first HTTP request**. |
| **`--default-auth-timing immediate`** | **`configureAuth`** runs when the module loads (JWT hydrates from `localStorage` immediately). |
| **`--jwt-access-key` / `--jwt-refresh-key`** | Optional; only with **`jwt`**. |

You still add **`setAuthRefreshHandler`** (and `applyRequestAuth` for custom API keys) in your app—those cannot be generated from the CLI. Regenerating applies the baked line only when **`client.ts` is rewritten** (`--override-client`).

### From the library repo (maintainers)

```bash
npm run generate
```

By default, the spec URL is `$BASE_URL/docs/openapi` when the `BASE_URL` env variable is set. If unset, it falls back to the ICIB default.

### Output

The generator creates an `api/` folder and a local manifest (`api-client.manifest.json`, gitignored):

```
api/
├── client.ts          # Axios instance, auth profiles, optional token refresh
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

### Authentication (`client.ts`)

The generated `client.ts` exports **`configureAuth`**, optional **`setDefaultAuthProfile`** (lazy init), token helpers, and **`setAuthRefreshHandler`** for 401/403 retry-after-refresh.

**Two ways to pick a profile**

- **`configureAuth(setup)`** — applies immediately (reloads JWT from `localStorage` with **`replace`** semantics). Use this when you need the right profile before any token calls or before reading storage.
- **`setDefaultAuthProfile(setup)`** — registers a default that runs automatically on the **first outgoing HTTP request** if you never called `configureAuth`. JWT tokens already set in memory with `setAuthToken` before that request are kept (**merge** with storage). Pass **`null`** to clear a pending default (only matters before that first lazy apply).

If you call **`configureAuth`** at any time, lazy default is skipped. Changing the profile later always goes through **`configureAuth`**.

| Profile | Behavior |
|--------|----------|
| **`{ kind: "jwt" }`** | Sends `Authorization: Bearer <accessToken>`. Persists **access** and **refresh** in `localStorage` (defaults: `accessToken`, `refreshToken`). Optional `accessStorageKey` / `refreshStorageKey`. **`configureAuth`** loads tokens from storage into memory (**replace**). Lazy init uses **merge** so in-memory tokens win over empty keys. |
| **`{ kind: "cookie" }`** | Sets `withCredentials: true` on the axios instance; does **not** set the Bearer header (cookie-based sessions). |
| **`{ kind: "custom" }`** | Implicit default if you never call `configureAuth` or `setDefaultAuthProfile`: Bearer from memory when `setAuthToken` was used. Optional **`applyRequestAuth`** replaces that and runs your logic per request. |

Useful exports from `./api` (or your `--out` path): **`setAuthToken`**, **`setRefreshToken`**, **`getAuthToken`**, **`getRefreshToken`**, **`clearAuthToken`**, **`configureAuth`**, **`setDefaultAuthProfile`**, **`resetAuthProfileState`**, **`setAuthRefreshHandler`**, **`client`**.

- **`resetAuthProfileState()`** — clears lazy registration and returns to implicit `custom` (as if the module just loaded); does not clear tokens (use **`clearAuthToken`**). Mostly for tests or unusual re-bootstrap scenarios.

- **`setAuthToken(access)`** or **`setAuthToken({ accessToken, refreshToken })`** — object form updates the refresh token when you pass `refreshToken`.
- **`setAuthRefreshHandler(async (saveToken) => { ... })`** — on 401/403, the handler runs (deduped if several requests fail at once); call **`saveToken`** the same way as `setAuthToken` to store new tokens after refresh.
- Refresh requests that must not trigger another refresh should use **`skipAuthRefresh: true`** on the axios config (see JSDoc on `InternalAxiosRequestConfig` in `client.ts`).

`localStorage` is only touched when the profile is **`jwt`**; in Node or SSR without `localStorage`, tokens stay in memory only.

#### How to set lazy auth

Lazy auth means you register a profile with **`setDefaultAuthProfile`**; it takes effect on the **first outgoing request** from the shared axios `client` (including anything called through **`apiClient`**), as long as you have **not** called **`configureAuth`** before that request.

**Steps**

1. In your app entry file (e.g. `main.tsx`, `main.ts`), import **`setDefaultAuthProfile`** from your generated `./api` (or your `--out` path).
2. Call **`setDefaultAuthProfile(setup)` once**, at module level or before you start calling the API — same timing as you would use for `configureAuth`, but nothing is applied until the first HTTP request.
3. **Do not call `configureAuth`** if you want lazy behavior; the first `configureAuth` disables lazy init for the rest of the page/session.
4. Optionally register **`setAuthRefreshHandler`** in the same module (before any request) if you use JWT refresh.
5. When your app first calls **`apiClient.…`** or **`client.…`**, the client applies the profile (JWT reads `localStorage` with **merge**: in-memory tokens from `setAuthToken` before that call are kept if storage is empty).

**JWT (lazy)**

```typescript
import {
  apiClient,
  client,
  setDefaultAuthProfile,
  setAuthToken,
  setAuthRefreshHandler,
  getRefreshToken,
} from "./api";

setDefaultAuthProfile({
  kind: "jwt",
  // optional: accessStorageKey: "myAccess", refreshStorageKey: "myRefresh",
});

setAuthRefreshHandler(async (saveToken) => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Not logged in");
  const { data } = await client.post<{
    accessToken: string;
    refreshToken: string;
  }>("/auth/refresh", { refreshToken }, { skipAuthRefresh: true });
  saveToken({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
});

// e.g. after login, or rely on merge from localStorage on first request:
setAuthToken({
  accessToken: loginResponse.accessToken,
  refreshToken: loginResponse.refreshToken,
});

await apiClient.someContext.list({ page: 1, size: 10 }); // first request applies lazy JWT
```

**Cookie session (lazy)**

```typescript
import { apiClient, setDefaultAuthProfile } from "./api";

setDefaultAuthProfile({ kind: "cookie" });
await apiClient.someContext.list({ page: 1, size: 10 }); // first request sets withCredentials, etc.
```

**Custom headers (lazy)**

```typescript
import { apiClient, setDefaultAuthProfile } from "./api";

setDefaultAuthProfile({
  kind: "custom",
  applyRequestAuth: (config) => {
    const key = import.meta.env.VITE_API_KEY;
    if (key) config.headers["X-API-Key"] = key;
  },
});

await apiClient.someContext.list({ page: 1, size: 10 });
```

To **clear** a registered default before the first request (uncommon), call **`setDefaultAuthProfile(null)`**.

**Nuxt 3**

If you generate with **`--default-auth jwt`** (lazy or immediate), you can **omit** `setDefaultAuthProfile` / `configureAuth` from Nuxt—`client.ts` already runs it on import. You still need a **client-only plugin** for **`setAuthRefreshHandler`** (refresh cannot be generated from the spec).

Otherwise put auth profile setup in a **client-only plugin** so it never runs during SSR—there is no `localStorage` on the server, and cookie/`withCredentials` behavior is browser-only.

Create `plugins/api-auth.client.ts` (the **`.client`** in the filename is required). If **`client.ts` was generated with `--default-auth jwt`**, only register the refresh handler:

```typescript
import { setAuthRefreshHandler, client, getRefreshToken } from "~/path/to/generated/api";

export default defineNuxtPlugin(() => {
  setAuthRefreshHandler(async (saveToken) => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return;
    const body = await client.post<{
      accessToken: string;
      refreshToken: string;
    }>("/auth/refresh", { refreshToken }, { skipAuthRefresh: true });
    saveToken({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    });
  });
});
```

If you did **not** bake auth at generate time, call **`setDefaultAuthProfile({ kind: "jwt" })`** (or **`configureAuth`**) in the same plugin **before** `setAuthRefreshHandler`.

Plugins run early on the client before your pages typically fire their first `useFetch`/`apiClient` call. If something else imports the API before plugins, rename the file so it runs first (e.g. `plugins/00-api-auth.client.ts`) or use Nuxt’s plugin `enforce: "pre"`.

**Refresh handlers and `applyRequestAuth`** still live in your app (or a small init module); use **`--default-auth`** only for the profile line you would otherwise repeat in every app.

#### Examples

**JWT (Bearer + `localStorage` for access and refresh) — immediate `configureAuth`**

```typescript
import {
  apiClient,
  client,
  configureAuth,
  setAuthToken,
  setAuthRefreshHandler,
  getRefreshToken,
} from "./api";

configureAuth({
  kind: "jwt",
  // optional: accessStorageKey: "myAccess", refreshStorageKey: "myRefresh",
});

// After login — both values are saved under the configured keys
setAuthToken({
  accessToken: loginResponse.accessToken,
  refreshToken: loginResponse.refreshToken,
});

setAuthRefreshHandler(async (saveToken) => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Not logged in");

  const { data } = await client.post<{
    accessToken: string;
    refreshToken: string;
  }>(
    "/auth/refresh", // use your real refresh path
    { refreshToken },
    { skipAuthRefresh: true },
  );

  saveToken({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
});

await apiClient.someContext.list({ page: 1, size: 10 });
```

**Cookie-based session**

```typescript
import { apiClient, configureAuth } from "./api";

configureAuth({ kind: "cookie" });

// No setAuthToken — the browser sends session cookies if the server issued them
// (Set-Cookie) and your API allows credentialed requests (CORS: Access-Control-Allow-Credentials, specific Origin).

await apiClient.someContext.list({ page: 1, size: 10 });
```

**Custom (e.g. API key or non-Bearer auth)**

`custom` without `applyRequestAuth` is the default: same as only calling `setAuthToken` for a Bearer access token. With `applyRequestAuth`, you attach whatever headers you need:

```typescript
import { apiClient, configureAuth } from "./api";

configureAuth({
  kind: "custom",
  applyRequestAuth: (config) => {
    const key = import.meta.env.VITE_API_KEY; // or process.env.API_KEY in Node
    if (key) {
      config.headers["X-API-Key"] = key;
    }
  },
});

await apiClient.someContext.list({ page: 1, size: 10 });
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
