import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { executeHeadwindRequest, getAccessToken, getBaseUrl, resetAuthStateForTests } from "../utils/client.js";
import { createFreshServer } from "../index.js";
import { getAllToolSpecs, callHeadwindTool } from "../tools.js";
import { getEnabledTiers } from "../tiers.js";
import { TOOL_TIERS } from "../tool-tiers.js";
import type { HeadwindCredentials } from "../utils/types.js";

const credentials: HeadwindCredentials = { username: "admin", password: "secret-password" };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("Headwind MDM client", () => {
  beforeEach(() => {
    resetAuthStateForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("logs in with an uppercase MD5 password hash and caches the bearer token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HMDM_USERNAME", credentials.username);
    vi.stubEnv("HMDM_PASSWORD", credentials.password);

    const token = await getAccessToken(credentials);
    expect(token).toBe("headwind-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const loginInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(loginInit?.method).toBe("POST");
    expect(loginInit?.redirect).toBe("manual");
    expect(JSON.parse(String(loginInit?.body))).toEqual({
      login: credentials.username,
      password: createHash("md5").update(credentials.password).digest("hex").toUpperCase(),
    });

    vi.setSystemTime(new Date("2026-11-03T12:21:00.000Z"));
    await expect(getAccessToken(credentials)).resolves.toBe("headwind-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("sends the cached bearer token on private endpoints and returns the data payload", async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public/jwt/login")) {
        return jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" });
      }
      return jsonResponse({ status: "OK", data: { device: { id: "device-1" } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HMDM_BASE_URL", "https://mdm.example.com");
    const token = await getAccessToken(credentials);
    const result = await executeHeadwindRequest({
      method: "GET",
      path: "/private/devices/device-1",
      credentials,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ device: { id: "device-1" } });
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it("relogs and retries once after a private endpoint returns 401", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      callCount += 1;
      const url = String(input);
      if (url.endsWith("/public/jwt/login")) {
        return jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" });
      }
      if (callCount === 2) {
        return jsonResponse({ status: "ERROR", message: "Token expired." }, 401);
      }
      return jsonResponse({ status: "OK", data: { device: { id: "device-1" } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HMDM_BASE_URL", "https://mdm.example.com");
    await getAccessToken(credentials);
    const result = await executeHeadwindRequest({
      method: "GET",
      path: "/private/devices/device-1",
      credentials,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("surfaces the ERROR envelope without leaking secrets", async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public/jwt/login")) {
        return jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" });
      }
      return jsonResponse({ status: "ERROR", message: "Invalid credentials password=secret-password" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeHeadwindRequest({
      method: "GET",
      path: "/private/devices",
      credentials,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("secret-password");
      expect(result.error.message).toContain("[redacted]");
    }
  });

  it("rejects unsafe base URLs, forbids redirects, and redacts credentials from errors", async () => {
    expect(getBaseUrl({ HMDM_BASE_URL: "https://evil.example.com" } as NodeJS.ProcessEnv)).toBe("https://evil.example.com/rest");
    expect(() => getBaseUrl({ HMDM_BASE_URL: "https://user:secret@mdm.example.com" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => getBaseUrl({ HMDM_BASE_URL: "http://mdm.example.com" } as NodeJS.ProcessEnv)).toThrow();
    expect(getBaseUrl({ HMDM_BASE_URL: "https://mdm.example.com" } as NodeJS.ProcessEnv)).toBe("https://mdm.example.com/rest");

    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      throw new Error("connect failed password=secret-password");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeHeadwindRequest({
      method: "GET",
      path: "/private/devices",
      credentials,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("secret-password");
    }
  });

  it("does not follow redirects", async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public/jwt/login")) {
        return jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" });
      }
      return jsonResponse({ status: "OK", data: { device: { id: "device-1" } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HMDM_BASE_URL", "https://mdm.example.com");
    await executeHeadwindRequest({
      method: "GET",
      path: "/private/devices",
      credentials,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe("manual");
  });
});

describe("Headwind MDM tools", () => {
  beforeEach(() => {
    resetAuthStateForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists 32 read, 17 write, and 12 admin tools", () => {
    const specs = getAllToolSpecs();
    const counts = { read: 0, write: 0, admin: 0 };
    for (const spec of specs) counts[spec.tier] += 1;
    expect(specs).toHaveLength(61);
    expect(counts).toEqual({ read: 32, write: 17, admin: 12 });
    expect([...getEnabledTiers()]).toEqual(["read"]);
  });

  it("lists 32 read, 17 write, and 12 admin tools over MCP tools/list", async () => {
    const server = createFreshServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "headwind-mcp-test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(32);
      expect(new Set(tools.map((tool) => tool.name)).size).toBe(32);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close(), clientTransport.close(), serverTransport.close()]);
    }
  });

  it("returns data from a mocked read tool call", async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public/jwt/login")) {
        return jsonResponse({ status: "OK", data: {} }, 200, { Authorization: "Bearer headwind-token" });
      }
      return jsonResponse({ status: "OK", data: { devices: { totalCount: 1, nodes: [{ id: "device-1" }] } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HMDM_USERNAME", credentials.username);
    vi.stubEnv("HMDM_PASSWORD", credentials.password);
    const result = await callHeadwindTool("hmdm_devices_search", { page: 1, size: 10 });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.type === "text" ? String(result.content[0].text) : "";
    expect(JSON.parse(text)).toEqual({ devices: { totalCount: 1, nodes: [{ id: "device-1" }] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("assigns a tier to every tool", () => {
    for (const spec of getAllToolSpecs()) {
      expect(TOOL_TIERS[spec.tool.name]).toBeDefined();
      expect(TOOL_TIERS[spec.tool.name]?.tier).toBe(spec.tier);
    }
  });
});
