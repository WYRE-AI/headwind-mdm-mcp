import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { Tool, CallToolResult };

export type HeadwindTier = "read" | "write" | "admin";

export type HeadwindHttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export interface HeadwindCredentials {
  username: string;
  password: string;
}

export interface HeadwindToolSpec {
  tool: Tool;
  operation: string;
  tier: HeadwindTier;
  method: HeadwindHttpMethod;
  path: string;
  required: string[];
  optional: string[];
  pathParams?: string[];
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface HeadwindClientError {
  kind: "config" | "auth" | "http" | "timeout" | "network" | "upsert";
  message: string;
}

export type HeadwindClientResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: HeadwindClientError };
