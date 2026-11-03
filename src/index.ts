#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAllToolSpecs, callHeadwindTool } from "./tools.js";
import type { HeadwindCredentials } from "./utils/types.js";
import { getCredentials, getBaseUrl, runWithCredentials } from "./utils/client.js";
import { getEnabledTiers } from "./tiers.js";
import { logger } from "./utils/logger.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const LOOPBACK_HOST = "127.0.0.1";
const MISSING_S2S_SECRET_ERROR = "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty.";
const PLACEHOLDER_S2S_SECRET_ERROR = "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder.";
const INSECURE_DEV_WARNING = "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. HTTP /mcp is starting with service-to-service authentication DISABLED, bound to 127.0.0.1 only.";

function refuseStart(message: string): never {
  logger.error(message);
  process.exit(1);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  if (normalized === "localhost" || normalized === "::1") return true;
  const bare = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const parts = bare.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === "127";
}

function resolveS2SSecret(env: NodeJS.ProcessEnv = process.env): { secret: string; insecureDev: boolean } {
  const raw = (env.CONDUIT_S2S_SECRET ?? "").trim();
  if (raw && KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    refuseStart(PLACEHOLDER_S2S_SECRET_ERROR);
  }
  if (raw) return { secret: raw, insecureDev: false };
  if (env.MCP_ALLOW_INSECURE_DEV === "1") return { secret: "", insecureDev: true };
  refuseStart(MISSING_S2S_SECRET_ERROR);
}

function resolveBindHost(s2SSecret: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.MCP_HTTP_HOST ?? "").trim();
  if (s2SSecret) return configured || LOOPBACK_HOST;
  if (configured && !isLoopbackBindHost(configured)) {
    logger.error(`WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. Binding 127.0.0.1 only.`);
  }
  return LOOPBACK_HOST;
}

export function createFreshServer(): Server {
  const server = new Server(
    { name: "mcp-server-headwind-mdm", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.onerror = (error) => {
    logger.error("MCP server error", { error: error instanceof Error ? error.message : String(error) });
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const enabled = getEnabledTiers();
    const tools = getAllToolSpecs()
      .filter((spec) => enabled.has(spec.tier))
      .map((spec) => spec.tool);
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info("Tool call received", { tool: name });
    try {
      return await callHeadwindTool(name, (args ?? {}) as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Tool call failed", { tool: name, error: message });
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  });
  return server;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, credentials?: HeadwindCredentials): Promise<void> {
  const server = createFreshServer();
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    if (credentials) {
      await runWithCredentials(credentials, () => transport.handleRequest(req, res));
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("MCP request handling failed", { error: message });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    }
  }
}

async function startStdioTransport(): Promise<void> {
  const server = createFreshServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Headwind MDM MCP server running on stdio");
}

async function startHttpTransport(): Promise<HttpServer> {
  const { secret: s2SSecret, insecureDev } = resolveS2SSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = resolveBindHost(s2SSecret);
  if (insecureDev) logger.error(INSECURE_DEV_WARNING);
  const authMode = (process.env.AUTH_MODE || "env").trim();
  if (authMode !== "env" && authMode !== "gateway") {
    refuseStart(`Refusing to start HTTP transport: AUTH_MODE must be "env" or "gateway" (got "${authMode}").`);
  }
  const isGatewayMode = authMode === "gateway";
  if (!isGatewayMode && !getCredentials()) {
    logger.warn("AUTH_MODE=env but HMDM_USERNAME or HMDM_PASSWORD is not set; tool calls will return an authentication error.");
  }
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/mcp") {
      if (s2SSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2SSecret)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid X-Gateway-S2S header." }));
        return;
      }
      if (isGatewayMode) {
        const username = headerValue(req.headers["x-hmdm-username"]);
        const password = headerValue(req.headers["x-hmdm-password"]);
        if (!username || !password) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing credentials", message: "Gateway mode requires X-HMDM-Username and X-HMDM-Password headers." }));
          return;
        }
        const credentials = { username, password };
        void handleMcpRequest(req, res, credentials);
        return;
      }
      void handleMcpRequest(req, res);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.off("error", onError);
      const address = httpServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      logger.info(`Headwind MDM MCP server listening on http://${host}:${actualPort}/mcp`);
      resolve();
    });
  });
  return httpServer;
}

async function main(): Promise<void> {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  const baseUrl = getBaseUrl();
  const enabledTiers = getEnabledTiers();
  logger.info("Starting Headwind MDM MCP server", {
    transport: transportType,
    apiUrl: baseUrl,
    enabledTiers: [...enabledTiers],
    toolCount: getAllToolSpecs().filter((spec) => enabledTiers.has(spec.tier)).length,
    logLevel: process.env.LOG_LEVEL || "info",
    nodeVersion: process.version,
  });
  if (transportType === "http") {
    const httpServer = await startHttpTransport();
    const shutdown = async () => {
      logger.info("Shutting down Headwind MDM MCP server...");
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    if (!getCredentials()) {
      logger.warn("AUTH_MODE=env but HMDM_USERNAME or HMDM_PASSWORD is not set; tool calls will return an authentication error.");
    }
    await startStdioTransport();
  }
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    logger.error("Fatal startup error", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
