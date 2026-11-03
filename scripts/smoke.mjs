#!/usr/bin/env node
// Smoke test: starts the built MCP server over stdio and exercises a mocked
// Headwind MDM REST endpoint on localhost. No external network access is used.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

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

async function withServer(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(root, "dist/index.js")],
    env: {
      ...getDefaultEnvironment(),
      HMDM_BASE_URL: mockUrl,
      HMDM_USERNAME: "smoke-user",
      HMDM_PASSWORD: "smoke-password",
      LOG_LEVEL: "warn",
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

async function main() {
  console.log("\n[1] default tiers (read only)");
  await withServer(async (client) => {
    const { tools } = await client.listTools();
    console.log(`  tools listed: ${tools.length}`);
    check(tools.length === 32, "32 tools at default tiers");
    check(tools.every((tool) => tool.annotations?.readOnlyHint === true), "every listed tool is read-only");

    const result = await client.callTool({
      name: "hmdm_devices_search",
      arguments: { page: 1, size: 10 },
    });
    const text = result.content.map((content) => content.text ?? "").join("");
    console.log(`  hmdm_devices_search -> ${text}`);
    check(!result.isError, "device search succeeded");
    check(JSON.parse(text).devices.totalCount === 1, "device search returned mocked data");

    const loginCall = seen.find((entry) => entry.url === "/rest/public/jwt/login");
    check(loginCall !== undefined, "login endpoint was called");
  });
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
