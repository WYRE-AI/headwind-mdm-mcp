import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ENDPOINTS } from "../endpoints.js";
import { createFreshServer } from "../index.js";
import { callHeadwindTool, getAllToolSpecs } from "../tools.js";
import { getEnabledTiers, parseEnabledTiers } from "../tiers.js";
import { TOOL_TIERS } from "../tool-tiers.js";
import {
  InputError,
  buildRequest,
  clearTokenCache,
  encodePathValue,
  pathParamNames,
  requiresAuth,
  runWithCredentials,
} from "../utils/client.js";
import type { EndpointSpec, ParamSpec } from "../utils/types.js";

const BASE = "https://mdm.example.com";

function sample(spec: ParamSpec): unknown {
  switch (spec.type) {
    case "string":
      return spec.enum?.[0] ?? "sample";
    case "integer":
      return Math.max(1, spec.minimum ?? 1);
    case "number":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [spec.items ? sample(spec.items) : "x"];
    case "object":
      return Object.fromEntries(Object.entries(spec.properties ?? {}).filter(([, p]) => !p.optional).map(([k, p]) => [k, sample(p)]));
  }
}

function sampleArgs(endpoint: EndpointSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(endpoint.params).filter(([, p]) => !p.optional).map(([k, p]) => [k, sample(p)]));
}

function bogusArgs(): Record<string, unknown> {
  return JSON.parse('{"bogus":"BOGUS-VALUE","__proto__":{"polluted":"BOGUS-VALUE"},"constructor":"BOGUS-VALUE"}') as Record<string, unknown>;
}

const ALL_TIERS = "read,write,admin";

function stubFetch(handler?: (url: string, init: RequestInit) => Response) {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/public/jwt/login")) {
      return new Response(JSON.stringify({ status: "OK", data: {} }), { status: 200, headers: { Authorization: "Bearer tok-one" } });
    }
    return handler ? handler(url, init ?? {}) : new Response(JSON.stringify({ status: "OK", data: { ok: true } }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  clearTokenCache();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("HMDM_BASE_URL", BASE);
  vi.stubEnv("HMDM_USERNAME", "test-admin");
  vi.stubEnv("HMDM_PASSWORD", "fake-password-for-tests");
  vi.stubEnv("HMDM_TOOL_TIERS", ALL_TIERS);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("tool catalogue and tiers", () => {
  it("has 32 read, 14 write and 15 admin tools (61 total)", () => {
    const counts = { read: 0, write: 0, admin: 0 };
    for (const spec of getAllToolSpecs()) counts[spec.tier] += 1;
    expect(getAllToolSpecs()).toHaveLength(61);
    expect(counts).toEqual({ read: 32, write: 14, admin: 15 });
    expect(new Set(ENDPOINTS.map((e) => e.name)).size).toBe(61);
    expect([...parseEnabledTiers(undefined)]).toEqual(["read"]);
  });

  it("uses admin only for irreversible actions and access/security settings", () => {
    const admin = ENDPOINTS.filter((e) => e.tier === "admin").map((e) => e.name).sort();
    expect(admin).toEqual(
      [
        "hmdm_devices_delete", "hmdm_devices_delete_bulk", "hmdm_configurations_delete", "hmdm_applications_delete",
        "hmdm_applications_versions_delete", "hmdm_groups_delete", "hmdm_messaging_delete", "hmdm_messaging_purge",
        "hmdm_push_delete", "hmdm_push_purge", "hmdm_push_task_delete",
        "hmdm_push_send", "hmdm_push_api_send", "hmdm_push_task_update",
        "hmdm_settings_misc_update",
      ].sort(),
    );
  });

  it("marks push senders admin with the irreversible warning", () => {
    for (const name of ["hmdm_push_send", "hmdm_push_api_send", "hmdm_push_task_update"]) {
      const endpoint = ENDPOINTS.find((e) => e.name === name) as EndpointSpec;
      expect(endpoint.tier).toBe("admin");
      expect(endpoint.description.startsWith("⚠ DESTRUCTIVE — IRREVERSIBLE [admin]")).toBe(true);
      expect(endpoint.description).toContain("can run commands, delete files or uninstall apps on real devices");
      expect(endpoint.destructiveHint).toBe(true);
    }
    const misc = ENDPOINTS.find((e) => e.name === "hmdm_settings_misc_update") as EndpointSpec;
    expect(misc.description.startsWith("⚠ HIGH-IMPACT [admin]")).toBe(true);
  });

  it("warns only where warranted and annotates consistently", () => {
    for (const e of ENDPOINTS) {
      const tool = getAllToolSpecs().find((s) => s.tool.name === e.name)!.tool;
      expect(tool.annotations?.readOnlyHint).toBe(e.tier === "read");
      expect(tool.annotations?.destructiveHint).toBe(e.destructiveHint);
      if (e.tier === "admin") expect(e.description).toMatch(/^⚠ (DESTRUCTIVE — IRREVERSIBLE|HIGH-IMPACT) \[admin\]/);
      else expect(e.description).not.toContain("⚠");
      if (e.tier === "read") expect(e.method === "GET" || e.method === "POST").toBe(true);
      if (e.name.includes("_delete") || e.name.includes("_purge")) expect(e.tier).toBe("admin");
    }
  });

  it("keeps schema/tiers.json and TOOL_TIERS in sync with the endpoint table", () => {
    const published = JSON.parse(readFileSync(new URL("../../schema/tiers.json", import.meta.url), "utf8")) as Record<string, { tier: string; operation: string }>;
    const derived = Object.fromEntries(Object.entries(TOOL_TIERS).map(([name, info]) => [name, { tier: info.tier, operation: info.operation }]));
    expect(published).toEqual(derived);
  });

  it("every tool has a real JSON inputSchema with declared properties", () => {
    for (const { tool, endpoint } of getAllToolSpecs()) {
      const schema = tool.inputSchema as { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(endpoint.params).sort());
      for (const name of pathParamNames(endpoint.path)) {
        expect(schema.properties[name], `${tool.name} path param ${name}`).toBeDefined();
        expect(schema.required, `${tool.name} path param ${name} required`).toContain(name);
      }
      // Every non-GET tool without path params declares its body fields.
      if (endpoint.method === "POST" || endpoint.method === "PUT") expect(Object.keys(schema.properties).length).toBeGreaterThan(0);
    }
  });

  it("lists only read tools by default over MCP tools/list", async () => {
    vi.stubEnv("HMDM_TOOL_TIERS", "");
    expect([...getEnabledTiers()]).toEqual(["read"]);
    const server = createFreshServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "headwind-test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(32);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
      vi.stubEnv("HMDM_TOOL_TIERS", ALL_TIERS);
      expect((await client.listTools()).tools).toHaveLength(61);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("refuses a tool whose tier is not enabled", async () => {
    vi.stubEnv("HMDM_TOOL_TIERS", "read");
    const mock = stubFetch();
    const result = await callHeadwindTool("hmdm_devices_delete", { id: 1 });
    expect(result.isError).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("path parameters", () => {
  const withPath = ENDPOINTS.filter((e) => pathParamNames(e.path).length > 0);

  it("covers the endpoints that have placeholders", () => {
    expect(withPath.length).toBeGreaterThan(20);
  });

  it("substitutes EVERY placeholder with the encoded value, leaving none behind", () => {
    const value = "dev 1?x=1&y#z%2e:é";
    for (const endpoint of withPath) {
      const args = sampleArgs(endpoint);
      for (const name of pathParamNames(endpoint.path)) args[name] = endpoint.params[name]?.type === "integer" ? 7 : value;
      const { path } = buildRequest(endpoint, args);
      expect(path, endpoint.name).not.toMatch(/[{}]/);
      expect(path, endpoint.name).not.toMatch(/\/:[A-Za-z]/);
      const expected = endpoint.path.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => encodeURIComponent(String(args[name])));
      expect(path, endpoint.name).toBe(expected);
      if (endpoint.params[pathParamNames(endpoint.path)[0] as string]?.type === "string") expect(path).toContain(encodeURIComponent(value));
    }
  });

  it("rejects empty, dot, separator and control-character values for every path param", () => {
    const bad = ["", ".", "..", "a/b", "a\\b", "/", "../x", "a\nb", "a\u0000b", "a\u007fb", "a\tb"];
    for (const endpoint of withPath) {
      for (const name of pathParamNames(endpoint.path)) {
        if (endpoint.params[name]?.type !== "string") continue;
        for (const value of bad) {
          expect(() => buildRequest(endpoint, { ...sampleArgs(endpoint), [name]: value }), `${endpoint.name} ${name}=${JSON.stringify(value)}`).toThrow(InputError);
        }
      }
    }
    expect(() => encodePathValue("id", "..")).toThrow(InputError);
    expect(() => encodePathValue("id", { toString: () => "x" })).toThrow(InputError);
    expect(encodePathValue("id", "a b")).toBe("a%20b");
  });

  it("does not send path params in the query or body", () => {
    for (const endpoint of withPath) {
      const args = sampleArgs(endpoint);
      for (const name of pathParamNames(endpoint.path)) args[name] = endpoint.params[name]?.type === "integer" ? 424242 : "PATH-VALUE";
      const request = buildRequest(endpoint, args);
      const rest = JSON.stringify({ query: request.query ?? null, body: request.body ?? null });
      expect(rest, endpoint.name).not.toContain("424242");
      expect(rest, endpoint.name).not.toContain("PATH-VALUE");
    }
  });

  it("rejects non-positive purge ranges and non-integer ids", () => {
    const purge = ENDPOINTS.find((e) => e.name === "hmdm_messaging_purge") as EndpointSpec;
    expect(() => buildRequest(purge, { days: 0 })).toThrow(InputError);
    expect(() => buildRequest(purge, { days: "30" })).toThrow(InputError);
    expect(buildRequest(purge, { days: 30 }).path).toBe("/plugins/messaging/private/purge/30");
    const del = ENDPOINTS.find((e) => e.name === "hmdm_devices_delete") as EndpointSpec;
    expect(() => buildRequest(del, { id: "1/../2" })).toThrow(InputError);
    expect(() => buildRequest(del, { id: 1.5 })).toThrow(InputError);
  });
});

describe("declared arguments only", () => {
  it("never forwards undeclared arguments for any tool (request builder)", () => {
    for (const endpoint of ENDPOINTS) {
      const request = buildRequest(endpoint, { ...sampleArgs(endpoint), ...bogusArgs() });
      const text = JSON.stringify(request);
      expect(text, endpoint.name).not.toContain("BOGUS-VALUE");
      expect(text, endpoint.name).not.toContain("bogus");
      expect(text, endpoint.name).not.toContain("polluted");
      expect(Object.hasOwn(Object(request.body ?? {}), "__proto__")).toBe(false);
    }
  });

  it("never forwards undeclared arguments for any tool (wire level) and sends a bearer token on every private/plugin call", async () => {
    for (const endpoint of ENDPOINTS) {
      clearTokenCache();
      const mock = stubFetch();
      const result = await callHeadwindTool(endpoint.name, { ...sampleArgs(endpoint), ...bogusArgs() });
      expect(result.isError, `${endpoint.name}: ${JSON.stringify(result.content)}`).toBeUndefined();
      const calls = mock.mock.calls.filter(([url]) => !String(url).endsWith("/public/jwt/login"));
      expect(calls).toHaveLength(1);
      const [url, init] = calls[0] as [string, RequestInit];
      expect(requiresAuth(new URL(String(url)).pathname.replace(/^\/rest/, ""))).toBe(true);
      expect(init.headers, endpoint.name).toMatchObject({ Authorization: "Bearer tok-one" });
      expect(`${String(url)} ${String(init.body ?? "")}`, endpoint.name).not.toMatch(/bogus|BOGUS|polluted/i);
      expect(init.method).toBe(endpoint.method);
      expect(init.redirect).toBe("manual");
    }
  });

  it("drops __proto__/constructor at every depth of an entity body", () => {
    const endpoint = ENDPOINTS.find((e) => e.name === "hmdm_configurations_update") as EndpointSpec;
    const configuration = JSON.parse('{"name":"n","__proto__":{"x":1},"applications":[{"constructor":{"y":1},"id":2}],"nested":{"__proto__":{"z":1},"ok":true}}') as unknown;
    const { body } = buildRequest(endpoint, { configuration });
    expect(JSON.stringify(body)).toBe('{"name":"n","applications":[{"id":2}],"nested":{"ok":true}}');
    expect(Object.hasOwn(body as object, "__proto__")).toBe(false);
  });

  it("validates required inputs and types", () => {
    const search = ENDPOINTS.find((e) => e.name === "hmdm_devices_search") as EndpointSpec;
    expect(() => buildRequest(search, { pageNum: "1" })).toThrow(InputError);
    expect(() => buildRequest(search, { pageSize: 5000 })).toThrow(InputError);
    expect(() => buildRequest(search, { sortDir: "SIDEWAYS" })).toThrow(InputError);
    expect(buildRequest(search, {})).toEqual({ method: "POST", path: "/private/devices/search" });
    const group = ENDPOINTS.find((e) => e.name === "hmdm_groups_update") as EndpointSpec;
    expect(() => buildRequest(group, {})).toThrow(/name/);
    const bulk = ENDPOINTS.find((e) => e.name === "hmdm_devices_group_bulk") as EndpointSpec;
    expect(() => buildRequest(bulk, { ids: [1], action: "set", groups: [{ name: "no id" }] })).toThrow(/groups\[0\]\.id/);
  });

  it("builds the upstream shapes: entity, flat body, text body, JSON array body", () => {
    const find = (name: string) => ENDPOINTS.find((e) => e.name === name) as EndpointSpec;
    expect(buildRequest(find("hmdm_devices_search"), { value: "x", pageNum: 2, pageSize: 10 }).body).toEqual({ value: "x", pageNum: 2, pageSize: 10 });
    expect(buildRequest(find("hmdm_devices_update"), { device: { number: "n1", extra: 1 } }).body).toEqual({ number: "n1", extra: 1 });
    expect(buildRequest(find("hmdm_configurations_copy"), { id: 3, name: "copy" })).toEqual({ method: "PUT", path: "/private/configurations/copy", body: { id: 3, name: "copy" } });
    expect(buildRequest(find("hmdm_devices_description_create"), { id: 3, description: "desc" })).toEqual({
      method: "POST", path: "/private/devices/3/description", body: "desc", bodyText: true,
    });
    expect(buildRequest(find("hmdm_devices_application_settings"), { id: 3, settings: [{ name: "a", value: "b" }] }).body).toEqual([{ name: "a", value: "b" }]);
    expect(buildRequest(find("hmdm_devices_delete_bulk"), { ids: [1, 2] }).body).toEqual({ ids: [1, 2] });
    expect(buildRequest(find("hmdm_devices_application_settings_notify"), { id: 3 })).toEqual({ method: "POST", path: "/private/devices/3/applicationSettings/notify" });
    expect(buildRequest(find("hmdm_devices_delete"), { id: 3 })).toEqual({ method: "DELETE", path: "/private/devices/3" });
  });
});

describe("authentication mode and base URL in tool calls", () => {
  it("every tool call is an error mentioning HMDM_BASE_URL when it is unset", async () => {
    vi.stubEnv("HMDM_BASE_URL", "");
    const mock = stubFetch();
    for (const endpoint of ENDPOINTS) {
      const result = await callHeadwindTool(endpoint.name, sampleArgs(endpoint));
      expect(result.isError, endpoint.name).toBe(true);
      expect(JSON.stringify(result.content)).toContain("HMDM_BASE_URL is required");
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it("gateway mode never falls back to env credentials", async () => {
    vi.stubEnv("AUTH_MODE", "gateway");
    const mock = stubFetch();
    const result = await callHeadwindTool("hmdm_devices_search", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("gateway mode");
    expect(mock).not.toHaveBeenCalled();
  });

  it("gateway mode uses the request-scoped credentials and a per-user token", async () => {
    vi.stubEnv("AUTH_MODE", "gateway");
    vi.stubEnv("HMDM_USERNAME", "");
    vi.stubEnv("HMDM_PASSWORD", "");
    const seen: Array<{ url: string; auth: string; login?: string }> = [];
    const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login")) {
        const login = (JSON.parse(String(init?.body)) as { login: string }).login;
        seen.push({ url, auth: "", login });
        return new Response("{}", { status: 200, headers: { Authorization: `Bearer tok-${login}` } });
      }
      seen.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
      return new Response(JSON.stringify({ status: "OK", data: { n: 1 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", mock);
    await runWithCredentials({ username: "alice", password: "fake-alice-pass" }, () => callHeadwindTool("hmdm_settings_get", {}));
    await runWithCredentials({ username: "bob", password: "fake-bob-pass" }, () => callHeadwindTool("hmdm_settings_get", {}));
    await runWithCredentials({ username: "alice", password: "fake-alice-pass" }, () => callHeadwindTool("hmdm_settings_get", {}));
    expect(seen.filter((s) => s.auth).map((s) => s.auth)).toEqual(["Bearer tok-alice", "Bearer tok-bob", "Bearer tok-alice"]);
    expect(seen.filter((s) => s.login).map((s) => s.login)).toEqual(["alice", "bob"]);
  });

  it("reports missing env credentials as a tool error", async () => {
    vi.stubEnv("HMDM_USERNAME", "");
    const mock = stubFetch();
    const result = await callHeadwindTool("hmdm_settings_get", {});
    expect(result.isError).toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns data from a mocked read call end to end", async () => {
    stubFetch(() => new Response(JSON.stringify({ status: "OK", data: { devices: { totalCount: 1, items: [{ id: 1 }] } } }), { status: 200 }));
    const result = await callHeadwindTool("hmdm_devices_search", { pageNum: 1, pageSize: 10 });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(JSON.parse(text)).toEqual({ devices: { totalCount: 1, items: [{ id: 1 }] } });
  });

  it("returns an is_error result with a redacted, bounded message for an ERROR envelope", async () => {
    stubFetch(() => new Response(JSON.stringify({ status: "ERROR", message: "boom Bearer abc.def.ghi password=fake-password-for-tests" }), { status: 200 }));
    const result = await callHeadwindTool("hmdm_devices_search", {});
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("boom");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("fake-password-for-tests");
  });
});
