import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_MESSAGE_CHARS,
  MAX_TOKEN_CACHE,
  TOKEN_TTL_MS,
  clearTokenCache,
  executeHeadwindRequest,
  getAccessToken,
  getBaseUrl,
  getCredentials,
  redactAndTruncate,
  redactData,
  resolveBaseUrl,
  resolveRequestCredentials,
  runWithCredentials,
  tokenCacheKeys,
  tokenCacheSize,
} from "../utils/client.js";
import type { HeadwindCredentials } from "../utils/types.js";

// Obviously fake test values.
const credentials: HeadwindCredentials = { username: "test-admin", password: "fake-password-for-tests" };
const BASE = "https://mdm.example.com";
const md5Upper = (value: string) => createHash("md5").update(value).digest("hex").toUpperCase();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function loginOk(token: string): Response {
  return json({ status: "OK", data: {} }, 200, { Authorization: `Bearer ${token}` });
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function stubFetch(handler: Handler) {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init ?? {}));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  clearTokenCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("HMDM_BASE_URL", BASE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("base URL", () => {
  it("is required: no default and no placeholder fallback", () => {
    expect(() => resolveBaseUrl(undefined)).toThrow(/HMDM_BASE_URL is required/);
    expect(() => resolveBaseUrl("   ")).toThrow(/HMDM_BASE_URL is required/);
    expect(() => getBaseUrl({} as NodeJS.ProcessEnv)).toThrow(/HMDM_BASE_URL is required/);
  });
  it("appends /rest exactly once", () => {
    expect(resolveBaseUrl("https://mdm.example.com")).toBe("https://mdm.example.com/rest");
    expect(resolveBaseUrl("https://mdm.example.com/")).toBe("https://mdm.example.com/rest");
    expect(resolveBaseUrl("https://mdm.example.com/rest")).toBe("https://mdm.example.com/rest");
    expect(resolveBaseUrl("https://mdm.example.com/rest/")).toBe("https://mdm.example.com/rest");
    expect(resolveBaseUrl("https://mdm.example.com/hmdm")).toBe("https://mdm.example.com/hmdm/rest");
    expect(resolveBaseUrl("https://mdm.example.com:8443/hmdm/rest")).toBe("https://mdm.example.com:8443/hmdm/rest");
  });
  it("accepts any operator-set https host, including private addresses", () => {
    expect(resolveBaseUrl("https://10.0.0.5")).toBe("https://10.0.0.5/rest");
    expect(resolveBaseUrl("https://mdm.internal.corp:8443")).toBe("https://mdm.internal.corp:8443/rest");
  });
  it("allows http only for localhost and 127.0.0.1", () => {
    expect(resolveBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/rest");
    expect(resolveBaseUrl("http://localhost:8080")).toBe("http://localhost:8080/rest");
    expect(() => resolveBaseUrl("http://mdm.example.com")).toThrow(/http is only allowed/);
    expect(() => resolveBaseUrl("http://10.0.0.5")).toThrow();
    expect(() => resolveBaseUrl("ftp://mdm.example.com")).toThrow();
  });
  it("rejects userinfo, fragments and query strings", () => {
    expect(() => resolveBaseUrl("https://user:pw@mdm.example.com")).toThrow(/userinfo/);
    expect(() => resolveBaseUrl("https://user@mdm.example.com")).toThrow(/userinfo/);
    expect(() => resolveBaseUrl("https://mdm.example.com/#frag")).toThrow();
    expect(() => resolveBaseUrl("https://mdm.example.com#")).toThrow();
    expect(() => resolveBaseUrl("https://mdm.example.com/?a=b")).toThrow();
    expect(() => resolveBaseUrl("not a url")).toThrow(/not a valid URL/);
  });
});

describe("login and token cache", () => {
  it("logs in with an uppercase MD5 password, never the plain password", async () => {
    const mock = stubFetch(() => loginOk("tok-one"));
    await expect(getAccessToken(credentials)).resolves.toBe("tok-one");
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/public/jwt/login`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const sent = String(init.body);
    expect(JSON.parse(sent)).toEqual({ login: credentials.username, password: md5Upper(credentials.password) });
    expect(sent).not.toContain(credentials.password);
  });

  it("caches the token and refreshes it after 20 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const mock = stubFetch(() => loginOk("tok-one"));
    await getAccessToken(credentials);
    await getAccessToken(credentials);
    expect(mock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + TOKEN_TTL_MS + 1000);
    await getAccessToken(credentials);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("never shares a token between different credentials (gateway users)", async () => {
    const mock = stubFetch((_url, init) => {
      const login = JSON.parse(String(init.body)) as { login: string };
      return loginOk(`tok-for-${login.login}`);
    });
    const alice = { username: "alice", password: "fake-alice-password" };
    const bob = { username: "bob", password: "fake-bob-password" };
    const aliceSamePasswordOtherUser = { username: "carol", password: "fake-alice-password" };
    expect(await getAccessToken(alice)).toBe("tok-for-alice");
    expect(await getAccessToken(bob)).toBe("tok-for-bob");
    expect(await getAccessToken(aliceSamePasswordOtherUser)).toBe("tok-for-carol");
    expect(await getAccessToken(alice)).toBe("tok-for-alice");
    expect(mock).toHaveBeenCalledTimes(3);
    // The same user on another server is a different cache entry too.
    expect(await getAccessToken(alice, "https://other.example.com/rest")).toBe("tok-for-alice");
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("keys the cache by HMAC-SHA256 digests, never plaintext secrets", async () => {
    stubFetch(() => loginOk("tok-one"));
    await getAccessToken(credentials);
    const keys = tokenCacheKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    for (const key of keys) {
      expect(key).not.toContain(credentials.password);
      expect(key).not.toContain(credentials.username);
      expect(key).not.toContain(md5Upper(credentials.password));
    }
  });

  it("uses keys that differ per credential and are not plain SHA-256", async () => {
    stubFetch(() => loginOk("tok-one"));
    const other = { username: "test-admin", password: "fake-other-password" };
    await getAccessToken(credentials);
    await getAccessToken(other);
    const keys = tokenCacheKeys();
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    const plain = createHash("sha256").update(JSON.stringify([`${BASE}/rest`, credentials.username, credentials.password])).digest("hex");
    expect(keys).not.toContain(plain);
  });

  it("shares one in-flight login between concurrent callers", async () => {
    const mock = stubFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return loginOk("tok-shared");
    });
    const tokens = await Promise.all(Array.from({ length: 5 }, () => getAccessToken(credentials)));
    expect(tokens).toEqual(Array(5).fill("tok-shared"));
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed login and retries on the next call", async () => {
    let n = 0;
    const mock = stubFetch(() => (++n === 1 ? json({ message: "bad credentials" }, 401) : loginOk("tok-ok")));
    await expect(getAccessToken(credentials)).rejects.toThrow();
    expect(await getAccessToken(credentials)).toBe("tok-ok");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not make different credentials share or block each other's login", async () => {
    const mock = stubFetch(async (_url, init) => {
      const login = (JSON.parse(String(init.body)) as { login: string }).login;
      return loginOk(`tok-${login}`);
    });
    const [a, b] = await Promise.all([
      getAccessToken({ username: "u1", password: "fake-pass-1" }),
      getAccessToken({ username: "u2", password: "fake-pass-2" }),
    ]);
    expect([a, b]).toEqual(["tok-u1", "tok-u2"]);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("is bounded (LRU) and sweeps expired entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const mock = stubFetch((_url, init) => loginOk(`tok-${(JSON.parse(String(init.body)) as { login: string }).login}`));
    const user = (n: number): HeadwindCredentials => ({ username: `user-${n}`, password: `fake-pass-${n}` });
    for (let n = 0; n < MAX_TOKEN_CACHE + 5; n++) await getAccessToken(user(n));
    expect(tokenCacheSize()).toBe(MAX_TOKEN_CACHE);
    const calls = mock.mock.calls.length;
    await getAccessToken(user(MAX_TOKEN_CACHE + 4)); // most recent: still cached
    expect(mock.mock.calls.length).toBe(calls);
    await getAccessToken(user(0)); // oldest was evicted: logs in again
    expect(mock.mock.calls.length).toBe(calls + 1);
    // Expired entries are swept on the next insert.
    vi.setSystemTime(Date.now() + TOKEN_TTL_MS + 1000);
    await getAccessToken({ username: "fresh", password: "fake-fresh-pass" });
    expect(tokenCacheSize()).toBe(1);
  });
});

describe("response size cap", () => {
  function streamed(chunks: number, chunkSize: number, onCancel?: () => void): Response {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= chunks) return controller.close();
        controller.enqueue(new Uint8Array(chunkSize).fill(97));
      },
      cancel() {
        onCancel?.();
      },
    });
    return new Response(body, { status: 200 });
  }

  it("aborts a streamed body once the cap is exceeded", async () => {
    let cancelled = false;
    stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : streamed(1000, 1_000_000, () => (cancelled = true))));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/too large/);
    expect(cancelled).toBe(true);
  });

  it("rejects early on an oversized Content-Length", async () => {
    stubFetch((url) =>
      url.endsWith("/login") ? loginOk("tok-one") : new Response("{}", { status: 200, headers: { "content-length": "99999999999" } }),
    );
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/too large/);
  });

  it("applies the cap to the login response too", async () => {
    stubFetch(() => streamed(1000, 1_000_000));
    await expect(getAccessToken(credentials)).rejects.toThrow(/too large/);
  });
});

describe("requests", () => {
  it("sends the bearer token and returns the data payload", async () => {
    const mock = stubFetch((url) => (url.endsWith("/public/jwt/login") ? loginOk("tok-one") : json({ status: "OK", data: { device: { id: 1 } } })));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/devices/number/abc", credentials });
    expect(result).toEqual({ ok: true, data: { device: { id: 1 } } });
    const [url, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/private/devices/number/abc`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok-one" });
    expect(init.redirect).toBe("manual");
  });

  it("returns array data unchanged", async () => {
    stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "OK", data: [{ id: 1 }, { id: 2 }] })));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/configurations/list", credentials });
    expect(result).toEqual({ ok: true, data: [{ id: 1 }, { id: 2 }] });
  });

  it("sends the bearer token on the plugin endpoint /plugin/main/private/active", async () => {
    const mock = stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "OK", data: [] })));
    await executeHeadwindRequest({ method: "GET", path: "/plugin/main/private/active", credentials });
    expect((mock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-one" });
  });

  it("re-authenticates and retries exactly once after a 401", async () => {
    let logins = 0;
    let calls = 0;
    stubFetch((url) => {
      if (url.endsWith("/login")) return loginOk(`tok-${++logins}`);
      calls += 1;
      return calls === 1 ? json({ status: "ERROR", message: "expired" }, 401) : json({ status: "OK", data: { ok: true } });
    });
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(logins).toBe(2);
    expect(calls).toBe(2);
  });

  it("stops after one retry when the upstream always answers 401", async () => {
    const mock = stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "ERROR" }, 401)));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    // login, request, login, request: bounded, no loop.
    expect(mock).toHaveBeenCalledTimes(4);
    expect(tokenCacheSize()).toBe(0);
  });

  it("returns a clean auth error when the re-login during the retry fails", async () => {
    let logins = 0;
    const mock = stubFetch((url) => {
      if (url.endsWith("/login")) return ++logins === 1 ? loginOk("tok-one") : json({ message: "bad credentials" }, 401);
      return json({ status: "ERROR" }, 401);
    });
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.message).toContain("authentication failed");
    }
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does not follow redirects and reports 3xx as an error", async () => {
    const mock = stubFetch((url) =>
      url.endsWith("/login") ? loginOk("tok-one") : new Response(null, { status: 302, headers: { Location: "https://elsewhere.example.net/" } }),
    );
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("redirect");
    expect((mock.mock.calls[1]?.[1] as RequestInit).redirect).toBe("manual");
  });

  it("surfaces the ERROR envelope", async () => {
    stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "ERROR", message: "error.duplicate.configuration" })));
    const result = await executeHeadwindRequest({ method: "PUT", path: "/private/configurations/copy", body: {}, credentials });
    expect(result).toEqual({ ok: false, error: { kind: "upsert", message: "error.duplicate.configuration" } });
  });

  it("sends plain-text bodies as text/plain", async () => {
    const mock = stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "OK" })));
    await executeHeadwindRequest({ method: "POST", path: "/private/devices/1/description", body: "hello", bodyText: true, credentials });
    const init = mock.mock.calls[1]?.[1] as RequestInit;
    expect(init.body).toBe("hello");
    expect(init.headers).toMatchObject({ "Content-Type": "text/plain; charset=utf-8" });
  });

  it("returns a config error (not a throw) when the base URL is missing", async () => {
    vi.stubEnv("HMDM_BASE_URL", "");
    const mock = stubFetch(() => loginOk("x"));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result).toMatchObject({ ok: false, error: { kind: "config" } });
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("redaction", () => {
  it("redacts BEFORE truncating: a secret straddling the cut never leaks a fragment", () => {
    const secret = "fake-straddle-secret-value";
    const text = "a".repeat(MAX_MESSAGE_CHARS - 6) + secret + "b".repeat(100);
    // Truncating first would leave the first six characters visible.
    expect(text.slice(0, MAX_MESSAGE_CHARS)).toContain("fake-s");
    const out = redactAndTruncate(text, [secret]);
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(out).not.toContain("fake-s");
    expect(out).not.toContain(secret);
  });

  it("redacts an upstream error message that straddles the truncation boundary", async () => {
    const md5 = md5Upper(credentials.password);
    const message = "x".repeat(MAX_MESSAGE_CHARS - 4) + credentials.password + md5 + "y".repeat(50);
    stubFetch((url) => (url.endsWith("/login") ? loginOk("tok-one") : json({ status: "ERROR", message })));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
      expect(result.error.message).not.toContain("fake-");
      expect(result.error.message).not.toContain(md5.slice(0, 6));
    }
  });

  it("redacts password, md5, token and Authorization values in successful data", async () => {
    const md5 = md5Upper(credentials.password);
    stubFetch((url) =>
      url.endsWith("/login")
        ? loginOk("tok-one")
        : json({ status: "OK", data: { note: `pw ${credentials.password} md5 ${md5} Authorization: Bearer tok-one`, list: [credentials.password], [credentials.password]: 1 } }),
    );
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    const text = JSON.stringify(result);
    expect(text).not.toContain(credentials.password);
    expect(text).not.toContain(md5);
    expect(text).not.toContain("tok-one");
    expect(text).toContain("[REDACTED]");
  });

  it("never echoes the MD5 of the password from a failed login", async () => {
    const md5 = md5Upper(credentials.password);
    stubFetch(() => json({ message: `bad login ${md5} ${md5.toLowerCase()} for ${credentials.password}` }, 401));
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain(md5);
    expect(text).not.toContain(md5.toLowerCase());
    expect(text).not.toContain(credentials.password);
  });

  it("redacts secrets in network errors", async () => {
    stubFetch(() => {
      throw new Error(`connect failed password=${credentials.password} Bearer abc.def`);
    });
    const result = await executeHeadwindRequest({ method: "GET", path: "/private/settings", credentials });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credentials.password);
    expect(JSON.stringify(result)).not.toContain("abc.def");
  });

  it("redactData handles nested values and keys", () => {
    expect(redactData({ a: ["s3cr3t-value", { "s3cr3t-value": "x" }], n: 1 }, ["s3cr3t-value"])).toEqual({
      a: ["[REDACTED]", { "[REDACTED]": "x" }],
      n: 1,
    });
  });
});

describe("credentials", () => {
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

  it("reads env credentials", () => {
    expect(getCredentials(env({ HMDM_USERNAME: " u ", HMDM_PASSWORD: " p " }))).toEqual({ username: "u", password: "p" });
    expect(getCredentials(env({}))).toHaveProperty("error");
  });

  it("gateway headers use lowercase lookup and never fall back to env", () => {
    const e = env({ HMDM_USERNAME: "env-user", HMDM_PASSWORD: "env-pass" });
    const seen: string[] = [];
    const headers: Record<string, string> = { "x-hmdm-username": "gw-user", "x-hmdm-password": "gw-pass" };
    expect(getCredentials(e, (name) => (seen.push(name), headers[name]))).toEqual({ username: "gw-user", password: "gw-pass" });
    expect(seen).toEqual(["x-hmdm-username", "x-hmdm-password"]);
    expect(getCredentials(e, () => undefined)).toHaveProperty("error");
    expect(getCredentials(e, (name) => (name === "x-hmdm-username" ? "gw-user" : undefined))).toHaveProperty("error");
  });

  it("gateway mode without scoped credentials is an error even when env credentials exist", () => {
    const e = env({ AUTH_MODE: "gateway", HMDM_USERNAME: "env-user", HMDM_PASSWORD: "env-pass" });
    expect(resolveRequestCredentials(e)).toEqual({ error: expect.stringContaining("gateway mode") });
    expect(runWithCredentials({ username: "scoped", password: "scoped-pass" }, () => resolveRequestCredentials(e))).toEqual({
      username: "scoped",
      password: "scoped-pass",
    });
    // Env mode still uses the environment.
    expect(resolveRequestCredentials(env({ HMDM_USERNAME: "u", HMDM_PASSWORD: "p" }))).toEqual({ username: "u", password: "p" });
  });
});
