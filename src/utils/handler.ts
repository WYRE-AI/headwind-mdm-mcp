import type { CallToolResult, Tool } from "./types.js";
import { callHeadwindTool, getAllToolSpecs } from "../tools.js";
import { getEnabledTiers } from "../tiers.js";

export function listTools(tiers: ReadonlySet<string> = getEnabledTiers()): Tool[] {
  return getAllToolSpecs()
    .filter((spec) => tiers.has(spec.tier))
    .map((spec) => spec.tool);
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return callHeadwindTool(name, args);
}
