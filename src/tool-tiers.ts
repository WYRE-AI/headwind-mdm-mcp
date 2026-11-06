import { ENDPOINTS } from "./endpoints.js";
import type { HeadwindTier } from "./utils/types.js";

export type ToolTier = HeadwindTier;

export interface ToolTierEntry {
  tier: ToolTier;
  operation: string;
  destructive: boolean;
}

/**
 * Derived from ENDPOINTS (the single source of truth). schema/tiers.json is a
 * published copy; a test fails if it drifts from this table.
 *
 * Tier policy: `admin` is reserved for irreversible actions (deletes, purges,
 * push messages that can run commands/delete files/uninstall apps on devices)
 * and access/security settings. Everything else is `write` or `read`.
 */
export const TOOL_TIERS: Record<string, ToolTierEntry> = Object.fromEntries(
  ENDPOINTS.map((endpoint) => [
    endpoint.name,
    { tier: endpoint.tier, operation: endpoint.operation, destructive: endpoint.destructiveHint },
  ]),
);

export const OPERATION_TO_TOOL: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_TIERS).map(([tool, info]) => [info.operation, tool]),
);

export function getToolTier(toolName: string): ToolTier | undefined {
  return TOOL_TIERS[toolName]?.tier;
}

export function getToolOperation(toolName: string): string | undefined {
  return TOOL_TIERS[toolName]?.operation;
}

export function isToolDestructive(toolName: string): boolean {
  return TOOL_TIERS[toolName]?.destructive === true;
}
