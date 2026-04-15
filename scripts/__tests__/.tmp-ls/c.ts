// Auto-generated Axios client
import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

declare module "axios" {
  interface InternalAxiosRequestConfig {
    /**
     * When true, 401/403 on this request will not run the auth refresh handler.
     * Set on refresh-token calls that use the same `client` to avoid retry loops.
     */
    skipAuthRefresh?: boolean;
  }
}

const AUTH_RETRY_MAX = 3;

const JWT_ACCESS_KEY = "a";
const JWT_REFRESH_KEY = "r";

function canUseLocalStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
}

function readStorage(key: string): string | null {
  if (!canUseLocalStorage()) return null;
  try {
    const v = localStorage.getItem(key);
    return v === "" ? null : v;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (!canUseLocalStorage()) return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* quota, private mode */
  }
}

function persistAccess(value: string | null): void {
  writeStorage(JWT_ACCESS_KEY, value);
}

function persistRefresh(value: string | null): void {
  writeStorage(JWT_REFRESH_KEY, value);
}

let _token: string | null = null;
let _refreshToken: string | null = null;
let _jwtHydrated = false;

export type AuthTokens = {
  accessToken: string | null;
  refreshToken?: string | null;
};

function setAuthTokenString(
  token: string | null,
  callback?: (token: string | null) => void,
): void {
  _token = token;
  persistAccess(token);
  if (callback) callback(token);
}

function setAuthTokenObject(
  tokens: AuthTokens,
  callback?: (tokens: AuthTokens) => void,
): void {
  _token = tokens.accessToken;
  persistAccess(tokens.accessToken);
  if (tokens.refreshToken !== undefined) {
    _refreshToken = tokens.refreshToken;
    persistRefresh(tokens.refreshToken);
  }
  if (callback) callback(tokens);
}

export function setAuthToken(
  token: string | null,
  callback?: (token: string | null) => void,
): void;
export function setAuthToken(
  tokens: AuthTokens,
  callback?: (tokens: AuthTokens) => void,
): void;
export function setAuthToken(
  tokenOrTokens: string | null | AuthTokens,
  callback?: ((token: string | null) => void) | ((tokens: AuthTokens) => void),
): void {
  if (
    tokenOrTokens !== null &&
    typeof tokenOrTokens === "object" &&
    "accessToken" in tokenOrTokens
  ) {
    setAuthTokenObject(tokenOrTokens, callback as (tokens: AuthTokens) => void | undefined);
  } else {
    setAuthTokenString(tokenOrTokens as string | null, callback as (token: string | null) => void | undefined);
  }
}

export function setRefreshToken(
  refreshToken: string | null,
  callback?: (refreshToken: string | null) => void,
): void {
  _refreshToken = refreshToken;
  persistRefresh(refreshToken);
  if (callback) callback(refreshToken);
}

export function getAuthToken(): string | null {
  return _token;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

export function clearAuthToken(): void {
  _token = null;
  _refreshToken = null;
  persistAccess(null);
  persistRefresh(null);
}

export type AuthRefreshHandler = (saveToken: typeof setAuthToken) => Promise<void>;

let _refreshHandler: AuthRefreshHandler | null = null;
let _refreshInFlight: Promise<void> | null = null;

export function setAuthRefreshHandler(handler: AuthRefreshHandler | null): void {
  _refreshHandler = handler;
}

export const client: AxiosInstance = axios.create({
  baseURL: "http://t",
  headers: {
    "Content-Type": "application/json",
  },
});

client.interceptors.request.use((config) => {
  if (!_jwtHydrated) {
    _jwtHydrated = true;
    _token = _token ?? readStorage(JWT_ACCESS_KEY);
    _refreshToken = _refreshToken ?? readStorage(JWT_REFRESH_KEY);
  }
  if (_token) {
    config.headers.Authorization = `Bearer ${_token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => {
    const responseType = response.config.responseType;
    if (responseType === "blob" || responseType === "arraybuffer") {
      return response;
    }
    return response.data;
  },
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) {
      return Promise.reject(error);
    }
    const originalConfig = error.config as InternalAxiosRequestConfig & {
      __authRetryCount?: number;
    };
    const status = error.response?.status;

    if (originalConfig.skipAuthRefresh) {
      if (status === 401) {
        clearAuthToken();
      }
      return Promise.reject(error);
    }

    if ((status !== 401 && status !== 403) || !_refreshHandler) {
      if (status === 401) {
        clearAuthToken();
      }
      return Promise.reject(error);
    }

    const retries = originalConfig.__authRetryCount ?? 0;
    if (retries >= AUTH_RETRY_MAX) {
      if (status === 401) {
        clearAuthToken();
      }
      return Promise.reject(error);
    }

    originalConfig.__authRetryCount = retries + 1;

    try {
      if (!_refreshInFlight) {
        _refreshInFlight = _refreshHandler(setAuthToken).finally(() => {
          _refreshInFlight = null;
        });
      }
      await _refreshInFlight;
    } catch {
      if (status === 401) {
        clearAuthToken();
      }
      return Promise.reject(error);
    }

    return client.request(originalConfig);
  },
);

/**
 * Normalizes blob requests when an older client interceptor still returns only
 * `response.data` (Blob). Current template returns the full AxiosResponse for
 * blob/arraybuffer so headers stay available.
 */
export function ensureBlobAxiosResponse(
  value: Blob | AxiosResponse<Blob>,
): AxiosResponse<Blob> {
  if (
    value &&
    typeof value === "object" &&
    "headers" in value &&
    "config" in value &&
    "status" in value
  ) {
    return value as AxiosResponse<Blob>;
  }
  return {
    data: value as Blob,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  };
}

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
