import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer, request } from "node:http";
import { createHmac } from "node:crypto";
import { isLoopbackBindHost, resolveS2sSecret, startHttpTransport } from "../index.js";
import { clearTokenCache } from "../utils/client.js";

// Obviously fake, not a real secret.
const FAKE_SECRET = "fake-test-secret-".padEnd(40, "0");

/** A valid gateway proof: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t=<unix seconds>">. */
function s2sHeader(secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`t=${t}`).digest("hex")}`;
}

function withExit(fn: () => unknown): string {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  } finally {
    exit.mockRestore();
  }
}

describe("resolveS2sSecret", () => {
  it("accepts a >=32 char secret", () => {
    expect(resolveS2sSecret({ CONDUIT_S2S_SECRET: FAKE_SECRET }).secret).toBe(FAKE_SECRET);
  });
  it("rejects short secrets and placeholders without printing the value", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases = [
      "short-secret-value", "changeme", "Change-Me", "secret", "placeholder", "replace-with-a-real-secret",
      "x".repeat(40), "X".repeat(40), "0".repeat(40),
      "your-secret-goes-here-please-replace", "your_s2s_secret_goes_here_please_replace", "CHANGEME-" + "a".repeat(30),
      "replace-with-your-own-generated-secret", "replace_me_" + "a".repeat(30),
    ];
    for (const value of cases) {
      expect(withExit(() => resolveS2sSecret({ CONDUIT_S2S_SECRET: value })), value).toBe("exit:1");
      const logged = err.mock.calls.map((c) => String(c[0])).join("");
      if (value.length > 12) expect(logged).not.toContain(value);
    }
    err.mockRestore();
  });
  it("rejects a 31-character secret and accepts exactly 32", () => {
    expect(withExit(() => resolveS2sSecret({ CONDUIT_S2S_SECRET: "k".repeat(31) }))).toBe("exit:1");
    expect(resolveS2sSecret({ CONDUIT_S2S_SECRET: "k".repeat(32) }).secret).toBe("k".repeat(32));
  });
  it("rejects a short secret even with MCP_ALLOW_INSECURE_DEV=1; empty+dev is allowed", () => {
    expect(withExit(() => resolveS2sSecret({ CONDUIT_S2S_SECRET: "tiny", MCP_ALLOW_INSECURE_DEV: "1" }))).toBe("exit:1");
    expect(withExit(() => resolveS2sSecret({ CONDUIT_S2S_SECRET: "x".repeat(40), MCP_ALLOW_INSECURE_DEV: "1" }))).toBe("exit:1");
    expect(withExit(() => resolveS2sSecret({}))).toBe("exit:1");
    expect(resolveS2sSecret({ MCP_ALLOW_INSECURE_DEV: "1" })).toEqual({ secret: "", insecureDev: true });
  });
});

describe("isLoopbackBindHost", () => {
  it("recognises loopback addresses only", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"]) expect(isLoopbackBindHost(h)).toBe(true);
    for (const h of ["0.0.0.0", "10.0.0.1", "example.com", "::", "128.0.0.1"]) expect(isLoopbackBindHost(h)).toBe(false);
  });
});

function send(port: number, opts: { host?: string; path?: string; body?: string; method?: string; headers?: Record<string, string> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: opts.path ?? "/mcp", method: opts.method ?? "POST", headers: { ...(opts.host ? { Host: opts.host } : {}), "Content-Type": "application/json", ...opts.headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

let server: Server | undefined;
let upstream: Server | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  clearTokenCache();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
  server = undefined;
  upstream = undefined;
});

async function start(env: Record<string, string>): Promise<number> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = { MCP_HTTP_PORT: String(port), MCP_HTTP_HOST: "127.0.0.1", HMDM_BASE_URL: "https://mdm.example.com", ...env };
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
  server = await startHttpTransport();
  return (server.address() as AddressInfo).port;
}

describe("Host header check (DNS rebinding)", () => {
  it("rejects unknown hosts with 403 and allows localhost, with or without port", async () => {
    const port = await start({ MCP_ALLOW_INSECURE_DEV: "1" });
    expect((await send(port, { host: "evil.example.net", body: "{}" })).status).toBe(403);
    expect((await send(port, { host: "evil.example.net:80", body: "{}" })).status).toBe(403);
    expect((await send(port, { host: "localhost:99999", body: "{}" })).status).toBe(403);
    expect((await send(port, { host: "localhost", body: "{}" })).status).not.toBe(403);
    expect((await send(port, { host: `127.0.0.1:${port}`, body: "{}" })).status).not.toBe(403);
  });
  it("honours MCP_ALLOWED_HOSTS and warns on entries with ports", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const port = await start({ CONDUIT_S2S_SECRET: FAKE_SECRET, MCP_ALLOWED_HOSTS: "mcp.example.com, bad.example.com:8080, ::1" });
    const logged = err.mock.calls.map((c) => String(c[0])).join("");
    err.mockRestore();
    expect(logged).toContain("bad.example.com:8080");
    expect(logged).toContain('"::1"');
    // Allowed host passes the host check and then fails S2S auth (401), not 403.
    expect((await send(port, { host: "mcp.example.com", body: "{}" })).status).toBe(401);
    expect((await send(port, { host: "other.example.com", body: "{}" })).status).toBe(403);
    expect((await send(port, { host: "bad.example.com:8080", body: "{}" })).status).toBe(403);
  });
  it("does not gate /health", async () => {
    const port = await start({ MCP_ALLOW_INSECURE_DEV: "1" });
    expect((await send(port, { host: "evil.example.net", path: "/health", method: "GET" })).status).toBe(200);
  });
});

describe("request body limit", () => {
  it("returns 413 for a declared or streamed body over 1 MiB, 400 for bad JSON", async () => {
    const port = await start({ MCP_ALLOW_INSECURE_DEV: "1" });
    const big = JSON.stringify({ pad: "a".repeat(1024 * 1024 + 10) });
    expect((await send(port, { body: big })).status).toBe(413);
    expect((await send(port, { body: "not json" })).status).toBe(400);
  });
  it("accepts a body under the limit", async () => {
    const port = await start({ MCP_ALLOW_INSECURE_DEV: "1" });
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const res = await send(port, { body: init, headers: { Accept: "application/json, text/event-stream" } });
    expect(res.status).toBe(200);
  });
});

describe("S2S and gateway authentication over HTTP", () => {
  it("rejects /mcp without a valid X-Gateway-S2S header", async () => {
    const port = await start({ CONDUIT_S2S_SECRET: FAKE_SECRET, AUTH_MODE: "gateway" });
    expect((await send(port, { body: "{}" })).status).toBe(401);
    expect((await send(port, { body: "{}", headers: { "X-Gateway-S2S": "wrong" } })).status).toBe(401);
  });

  it("returns 401 in gateway mode when the credential headers are missing (no env fallback)", async () => {
    const port = await start({
      CONDUIT_S2S_SECRET: FAKE_SECRET, AUTH_MODE: "gateway", HMDM_USERNAME: "env-user", HMDM_PASSWORD: "env-fake-pass",
    });
    const headers = { "X-Gateway-S2S": s2sHeader(FAKE_SECRET) };
    expect((await send(port, { body: "{}", headers })).status).toBe(401);
    expect((await send(port, { body: "{}", headers: { ...headers, "X-HMDM-Username": "u" } })).status).toBe(401);
    expect((await send(port, { body: "{}", headers: { ...headers, "X-HMDM-Password": "p" } })).status).toBe(401);
  });

  it("gives each gateway user their own upstream login and token", async () => {
    const seen: Array<{ path: string; auth?: string; login?: string }> = [];
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/rest/public/jwt/login") {
          const login = (JSON.parse(body) as { login: string }).login;
          seen.push({ path: req.url, login });
          res.writeHead(200, { "Content-Type": "application/json", Authorization: `Bearer tok-${login}` });
          res.end("{}");
          return;
        }
        seen.push({ path: req.url ?? "", auth: req.headers.authorization });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "OK", data: { who: req.headers.authorization } }));
      });
    });
    await new Promise<void>((r) => upstream!.listen(0, "127.0.0.1", r));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const port = await start({
      CONDUIT_S2S_SECRET: FAKE_SECRET, AUTH_MODE: "gateway", HMDM_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      HMDM_USERNAME: "env-user", HMDM_PASSWORD: "env-fake-pass",
    });
    const call = (user: string) =>
      send(port, {
        headers: { "X-Gateway-S2S": s2sHeader(FAKE_SECRET), "X-HMDM-Username": user, "X-HMDM-Password": `fake-pass-${user}`, Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hmdm_settings_get", arguments: {} } }),
      });
    const alice = await call("alice");
    const bob = await call("bob");
    // Tokens echoed by the upstream are redacted from the result.
    expect(alice.body).not.toContain("tok-alice");
    expect(bob.body).not.toContain("tok-");
    expect(seen.filter((s) => s.auth).map((s) => s.auth)).toEqual(["Bearer tok-alice", "Bearer tok-bob"]);
    expect(seen.filter((s) => s.login).map((s) => s.login)).toEqual(["alice", "bob"]);
    expect(seen.some((s) => s.login === "env-user")).toBe(false);
  });
});
