import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";
import MockAdapter from "axios-mock-adapter";
import type { AxiosRequestConfig } from "axios";
import { generateClient } from "../generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, ".runtime-gen");
const RUNTIME_CLIENT = join(RUNTIME_DIR, "generated-client.ts");

type RefreshHandler = (
  saveToken: (
    token: string | null,
    callback?: (token: string | null) => void,
  ) => void,
) => Promise<void>;

interface LoadedClient {
  client: import("axios").AxiosInstance;
  setAuthToken: (
    token: string | null,
    callback?: (token: string | null) => void,
  ) => void;
  clearAuthToken: () => void;
  getAuthToken: () => string | null;
  setAuthRefreshHandler: (handler: RefreshHandler | null) => void;
}

describe("generated client (auth refresh)", () => {
  let mod: LoadedClient;
  let mock: MockAdapter;

  beforeAll(async () => {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(
      RUNTIME_CLIENT,
      generateClient("http://auth-refresh.test"),
      "utf-8",
    );
    const url = pathToFileURL(RUNTIME_CLIENT).href;
    mod = (await import(url)) as LoadedClient;
    mock = new MockAdapter(mod.client as never);
  });

  afterAll(() => {
    mock.restore();
    try {
      rmSync(RUNTIME_DIR, { recursive: true, force: true });
    } catch {
      /* temp cleanup best-effort */
    }
  });

  beforeEach(() => {
    mock.reset();
    mod.clearAuthToken();
    mod.setAuthRefreshHandler(null);
  });

  it("returns JSON body on 200 (response unwrap)", async () => {
    mock.onGet("/ok").reply(200, { hello: "world" });
    const data = await mod.client.get("/ok");
    expect(data).toEqual({ hello: "world" });
  });

  it("401 without refresh handler clears token and rejects", async () => {
    mod.setAuthToken("stale");
    mock.onGet("/x").reply(401);
    await expect(mod.client.get("/x")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(mod.getAuthToken()).toBeNull();
  });

  it("403 without refresh handler rejects and does not clear token", async () => {
    mod.setAuthToken("kept");
    mock.onGet("/x").reply(403);
    await expect(mod.client.get("/x")).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(mod.getAuthToken()).toBe("kept");
  });

  it("401 with refresh handler runs refresh once and retries with new token", async () => {
    let refreshRuns = 0;
    mod.setAuthToken("old");
    mod.setAuthRefreshHandler(async (saveToken) => {
      refreshRuns += 1;
      saveToken("fresh");
    });
    mock.onGet("/resource").replyOnce(401).onGet("/resource").reply(200, {
      ok: true,
    });

    const data = await mod.client.get("/resource");
    expect(data).toEqual({ ok: true });
    expect(refreshRuns).toBe(1);
    expect(mod.getAuthToken()).toBe("fresh");
  });

  it("403 with refresh handler refreshes and retries like 401", async () => {
    let refreshRuns = 0;
    mod.setAuthToken("old");
    mod.setAuthRefreshHandler(async (saveToken) => {
      refreshRuns += 1;
      saveToken("after-403");
    });
    mock.onGet("/r").replyOnce(403).onGet("/r").reply(200, { fixed: 1 });

    const data = await mod.client.get("/r");
    expect(data).toEqual({ fixed: 1 });
    expect(refreshRuns).toBe(1);
    expect(mod.getAuthToken()).toBe("after-403");
  });

  it("forwards setAuthToken persistence callback from refresh saveToken", async () => {
    const persisted: string[] = [];
    mod.setAuthToken("old");
    mod.setAuthRefreshHandler(async (saveToken) => {
      saveToken("new", (t) => {
        if (t !== null) persisted.push(t);
      });
    });
    mock.onGet("/p").replyOnce(401).onGet("/p").reply(200, {});

    await mod.client.get("/p");
    expect(persisted).toEqual(["new"]);
    expect(mod.getAuthToken()).toBe("new");
  });

  it("failed refresh rejects and clears token on 401", async () => {
    mod.setAuthToken("old");
    mod.setAuthRefreshHandler(async () => {
      throw new Error("refresh failed");
    });
    mock.onGet("/fail").reply(401);

    await expect(mod.client.get("/fail")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(mod.getAuthToken()).toBeNull();
  });

  it("stops after AUTH_RETRY_MAX failed retries and clears token on 401", async () => {
    let refreshRuns = 0;
    mod.setAuthToken("t");
    mod.setAuthRefreshHandler(async (saveToken) => {
      refreshRuns += 1;
      saveToken(`t-${refreshRuns}`);
    });
    mock.onGet("/loop").reply(401);

    await expect(mod.client.get("/loop")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(refreshRuns).toBe(3);
    expect(mod.getAuthToken()).toBeNull();
  });

  it("skipAuthRefresh avoids refresh and clears token on 401", async () => {
    let refreshRuns = 0;
    mod.setAuthToken("x");
    mod.setAuthRefreshHandler(async () => {
      refreshRuns += 1;
    });
    mock.onGet("/nope").reply(401);

    await expect(
      mod.client.get("/nope", {
        skipAuthRefresh: true,
      } as AxiosRequestConfig & { skipAuthRefresh?: boolean }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(refreshRuns).toBe(0);
    expect(mod.getAuthToken()).toBeNull();
  });

  it("dedupes concurrent 401s into a single refresh", async () => {
    let refreshRuns = 0;
    mod.setAuthToken("shared");
    mod.setAuthRefreshHandler(async (saveToken) => {
      refreshRuns += 1;
      saveToken("renewed");
    });
    mock
      .onGet("/a")
      .replyOnce(401)
      .onGet("/a")
      .reply(200, { which: "a" });
    mock
      .onGet("/b")
      .replyOnce(401)
      .onGet("/b")
      .reply(200, { which: "b" });

    const [a, b] = await Promise.all([
      mod.client.get("/a"),
      mod.client.get("/b"),
    ]);
    expect(a).toEqual({ which: "a" });
    expect(b).toEqual({ which: "b" });
    expect(refreshRuns).toBe(1);
  });
});
