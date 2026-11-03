import type { CallToolResult } from "./types.js";
import { callHeadwindTool } from "../tools.js";

export async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return callHeadwindTool(name, args);
}
