import { TOOL_TIERS, type ToolTier } from "./tool-tiers.js";

export const ALL_TIERS: readonly ToolTier[] = ["read", "write", "admin"];
export const DEFAULT_TIERS: readonly ToolTier[] = ["read"];

export function parseEnabledTiers(raw: string | undefined): Set<ToolTier> {
  const tokens = (raw ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return new Set(DEFAULT_TIERS);
  const enabled = new Set<ToolTier>();
  for (const token of tokens) {
    if (!(ALL_TIERS as readonly string[]).includes(token)) {
      throw new Error(
        `Invalid HMDM_TOOL_TIERS value "${token}". Allowed: ${ALL_TIERS.join(", ")} (comma separated).`,
      );
    }
    enabled.add(token as ToolTier);
  }
  return enabled;
}

export function getEnabledTiers(env: NodeJS.ProcessEnv = process.env): Set<ToolTier> {
  return parseEnabledTiers(env.HMDM_TOOL_TIERS);
}

export function isToolEnabled(toolName: string, enabled: ReadonlySet<ToolTier>): boolean {
  const info = TOOL_TIERS[toolName];
  return info !== undefined && enabled.has(info.tier);
}
