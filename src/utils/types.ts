import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { Tool, CallToolResult };

export type HeadwindTier = "read" | "write" | "admin";

export type HeadwindHttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export interface HeadwindCredentials {
  username: string;
  password: string;
}

export type ParamType = "string" | "integer" | "number" | "boolean" | "array" | "object";

/** Declarative description of one tool argument (also rendered as JSON Schema). */
export interface ParamSpec {
  type: ParamType;
  description?: string;
  optional?: boolean;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  items?: ParamSpec;
  /** Declared nested properties (objects). Nested entity payloads may carry more fields. */
  properties?: Record<string, ParamSpec>;
}

export interface EndpointSpec {
  /** MCP tool name. */
  name: string;
  tier: HeadwindTier;
  method: HeadwindHttpMethod;
  /** Path template relative to `<base>/rest`; placeholders look like `{id}`. */
  path: string;
  operation: string;
  description: string;
  /** Explicit destructive annotation (admin deletes/purges, high-impact settings and push). */
  destructiveHint: boolean;
  /** Every argument the tool accepts. Anything else is dropped. */
  params: Record<string, ParamSpec>;
  /** When set, this argument's value is sent as the whole request body. */
  bodyParam?: string;
  /** Send the `bodyParam` value as a plain-text body instead of JSON. */
  bodyText?: boolean;
}

export interface HeadwindClientError {
  kind: "config" | "auth" | "http" | "timeout" | "network" | "upsert" | "input";
  message: string;
}

export type HeadwindClientResult =
  | { ok: true; data: unknown }
  | { ok: false; error: HeadwindClientError };

/** A fully built (validated) upstream request. */
export interface BuiltRequest {
  method: HeadwindHttpMethod;
  /** Path under `<base>/rest`, with every placeholder substituted and encoded. */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  bodyText?: boolean;
}
