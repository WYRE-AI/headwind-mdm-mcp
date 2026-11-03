#!/usr/bin/env node
// Smoke test: starts the built MCP server over stdio and exercises a mocked
// Headwind MDM REST endpoint on localhost. No external network access is used.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

const seen = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/rest/public/jwt/login") {
      seen.push({ url: req.url, body });
      res.writeHead(200, {
        "Content-Type": "application/json",
        Authorization: "Bearer headwind-smoke-token",
      });
      return res.end(JSON.stringify({ status: "OK", data: {} }));
    }
    if (req.method === "POST" && req.url === "/rest/private/devices/search") {
      seen.push({ url: req.url, body });
      return res.end(
        JSON.stringify({
          status: "OK",
          data: { devices: { totalCount: 1, nodes: [{ id: "device-1" }] } },
        }),
      );
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ERROR", message: "Mock endpoint not found." }));
  });
});

await new Promise((resolvePromise, reject) => {
  mock.once("error", reject);
  mock.listen(0, "127.0.0.1", () => {
    mock.off("error", reject);
    resolvePromise();
  });
});

const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log(`mock Headwind MDM REST endpoint on ${mockUrl}`);

async function withServer(extraEnv, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(root, "dist/index.js")],
    env: {
      ...getDefaultEnvironment(),
      HMDM_BASE_URL: mockUrl,
      HMDM_USERNAME: "smoke-user",
      HMDM_PASSWORD: "smoke-password",
      LOG_LEVEL: "warn",
      ...extraEnv,
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "headwind-mdm-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await transport.close();
  }
}

const textOf = (result) => result.content.map((content) => content.text ?? "").join("");

async function main() {
  console.log("\n[1] default tiers (read only)");
  await withServer({}, async (client) => {
    const { tools } = await client.listTools();
    console.log(`  tools listed: ${tools.length}`);
    check(tools.length === 32, "32 tools at default tiers");
    check(tools.every((tool) => tool.annotations?.readOnlyHint === true), "every listed tool is read-only");
    check(tools.every((tool) => tool.inputSchema?.properties !== undefined), "every tool has an inputSchema with properties");

    const result = await client.callTool({
      name: "hmdm_devices_search",
      arguments: { pageNum: 1, pageSize: 10, bogus: "do-not-forward" },
    });
    const text = textOf(result);
    console.log(`  hmdm_devices_search -> ${text}`);
    check(!result.isError, "device search succeeded");
    check(JSON.parse(text).devices.totalCount === 1, "device search returned mocked data");

    const loginCall = seen.find((entry) => entry.url === "/rest/public/jwt/login");
    check(loginCall !== undefined, "login endpoint was called");
    check(loginCall !== undefined && !loginCall.body.includes("smoke-password"), "login sends the MD5, not the plain password");
    const searchCall = seen.find((entry) => entry.url === "/rest/private/devices/search");
    check(searchCall?.body === JSON.stringify({ pageNum: 1, pageSize: 10 }), "only declared arguments are forwarded");
  });

  console.log("\n[2] all tiers");
  await withServer({ HMDM_TOOL_TIERS: "read,write,admin" }, async (client) => {
    const { tools } = await client.listTools();
    check(tools.length === 61, "61 tools with all tiers");
    check(new Set(tools.map((tool) => tool.name)).size === 61, "tool names are unique");
    const bad = await client.callTool({ name: "hmdm_devices_delete", arguments: { id: "../1" } });
    check(bad.isError === true, "path parameter with a separator is rejected");
  });

  console.log("\n[base-url] no default HMDM_BASE_URL");
  await withServer({ HMDM_BASE_URL: "" }, async (client) => {
    const { tools } = await client.listTools();
    check(tools.length === 32, "stdio with HMDM_BASE_URL unset still lists tools");
    const result = await client.callTool({ name: "hmdm_devices_search", arguments: {} });
    check(result.isError === true && textOf(result).includes("HMDM_BASE_URL is required"), "tool calls return is_error mentioning HMDM_BASE_URL is required");
  });
  const httpExit = await new Promise((resolveExit) => {
    const env = { ...process.env, MCP_TRANSPORT: "http", AUTH_MODE: "env", MCP_HTTP_PORT: "0", LOG_LEVEL: "warn" };
    delete env.HMDM_BASE_URL;
    const proc = spawn(process.execPath, [resolve(root, "dist/index.js")], { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => { proc.kill(); resolveExit({ code: "timeout", stderr }); }, 5000);
    proc.on("exit", (code) => { clearTimeout(timer); resolveExit({ code, stderr }); });
  });
  check(httpExit.code === 1 && httpExit.stderr.includes("HMDM_BASE_URL is required"), "http mode with HMDM_BASE_URL unset exits 1 at startup");
}

try {
  await main();
} catch (error) {
  console.error("smoke test crashed:", error);
  failures.push("crash");
} finally {
  await new Promise((resolvePromise, reject) => {
    mock.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

if (failures.length > 0) {
  console.error(`\nSMOKE FAILED (${failures.length}): ${failures.join("; ")}`);
  process.exit(1);
}

console.log("\nSMOKE PASSED");
