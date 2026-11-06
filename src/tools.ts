import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EndpointSpec, HeadwindTier, ParamSpec } from "./utils/types.js";
import { ENDPOINTS } from "./endpoints.js";
import { InputError, buildRequest, executeHeadwindRequest, getBaseUrl, resolveRequestCredentials } from "./utils/client.js";
import { getEnabledTiers } from "./tiers.js";

export interface HeadwindToolSpec {
  tool: Tool;
  endpoint: EndpointSpec;
  tier: HeadwindTier;
}

function toSchema(param: ParamSpec): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: param.type };
  if (param.description) schema.description = param.description;
  if (param.enum) schema.enum = [...param.enum];
  if (param.minimum !== undefined) schema.minimum = param.minimum;
  if (param.maximum !== undefined) schema.maximum = param.maximum;
  if (param.items) schema.items = toSchema(param.items);
  if (param.properties) {
    schema.properties = Object.fromEntries(Object.entries(param.properties).map(([key, value]) => [key, toSchema(value)]));
    const required = Object.entries(param.properties).filter(([, value]) => !value.optional).map(([key]) => key);
    if (required.length > 0) schema.required = required;
  }
  return schema;
}

function makeTool(endpoint: EndpointSpec): Tool {
  return {
    name: endpoint.name,
    description: endpoint.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(Object.entries(endpoint.params).map(([key, value]) => [key, toSchema(value)])),
      required: Object.entries(endpoint.params).filter(([, value]) => !value.optional).map(([key]) => key),
      additionalProperties: false,
    },
    annotations: {
      title: `Headwind MDM: ${endpoint.name}`,
      readOnlyHint: endpoint.tier === "read",
      destructiveHint: endpoint.destructiveHint,
      // PUT endpoints are create-or-update (or copy) and create a new resource when id is omitted.
      idempotentHint: endpoint.method === "GET" || endpoint.method === "DELETE",
      openWorldHint: true,
    },
  };
}

const SPECS: readonly HeadwindToolSpec[] = ENDPOINTS.map((endpoint) => ({ tool: makeTool(endpoint), endpoint, tier: endpoint.tier }));

export function getAllToolSpecs(): readonly HeadwindToolSpec[] {
  return SPECS;
}

export function getToolSpec(name: string): HeadwindToolSpec | undefined {
  return SPECS.find((spec) => spec.tool.name === name);
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export async function callHeadwindTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const spec = getToolSpec(name);
  if (!spec) return errorResult(`Unknown tool: ${name}`);
  if (!getEnabledTiers().has(spec.tier)) {
    return errorResult(`Tool ${name} requires the "${spec.tier}" tier, which is not enabled.`);
  }
  // The base URL is required and has no default; without it every call is an error.
  let baseUrl: string;
  try {
    baseUrl = getBaseUrl();
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
  const credentials = resolveRequestCredentials();
  if ("error" in credentials) return errorResult(credentials.error);
  let request;
  try {
    request = buildRequest(spec.endpoint, args);
  } catch (error) {
    if (error instanceof InputError) return errorResult(error.message);
    throw error;
  }
  const result = await executeHeadwindRequest({ ...request, credentials, baseUrl });
  if (!result.ok) return errorResult(result.error.message);
  return { content: [{ type: "text", text: JSON.stringify(result.data ?? null) }] };
}
