import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HeadwindHttpMethod, HeadwindTier, HeadwindToolSpec } from "./utils/types.js";
import { executeHeadwindRequest } from "./utils/client.js";
import { getCredentials } from "./utils/client.js";
import { getEnabledTiers } from "./tiers.js";

interface EndpointSpec {
  tier: HeadwindTier;
  method: HeadwindHttpMethod;
  path: string;
  operation: string;
  toolName: string;
  description: string;
  required?: string[];
  optional?: string[];
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

const ENDPOINTS: readonly EndpointSpec[] = [
  { tier: "read", method: "POST", path: "/private/devices/search", operation: "devicesSearch", toolName: "hmdm_devices_search", description: "[read] Search devices.", required: ["page", "size"] },
  { tier: "read", method: "GET", path: "/private/devices/number/{number}", operation: "devicesNumberGet", toolName: "hmdm_devices_number_get", description: "[read] Get a device by number.", required: ["number"] },
  { tier: "read", method: "GET", path: "/private/devices/{id}/applicationSettings", operation: "devicesApplicationSettingsGet", toolName: "hmdm_devices_application_settings_get", description: "[read] Get device application settings.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/configurations/search", operation: "configurationsSearch", toolName: "hmdm_configurations_search", description: "[read] Search configurations." },
  { tier: "read", method: "GET", path: "/private/configurations/list", operation: "configurationsList", toolName: "hmdm_configurations_list", description: "[read] List configurations." },
  { tier: "read", method: "GET", path: "/private/configurations/search/{value}", operation: "configurationsSearchByValue", toolName: "hmdm_configurations_search_value", description: "[read] Search configurations by value.", required: ["value"] },
  { tier: "read", method: "GET", path: "/private/configurations/{id}", operation: "configurationsGet", toolName: "hmdm_configurations_get", description: "[read] Get a configuration.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/configurations/applications/{id}", operation: "configurationsApplicationsGet", toolName: "hmdm_configurations_applications_get", description: "[read] Get configuration applications.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/applications/search", operation: "applicationsSearch", toolName: "hmdm_applications_search", description: "[read] Search applications." },
  { tier: "read", method: "GET", path: "/private/applications/search/{value}", operation: "applicationsSearchByValue", toolName: "hmdm_applications_search_value", description: "[read] Search applications by value.", required: ["value"] },
  { tier: "read", method: "GET", path: "/private/applications/{id}", operation: "applicationsGet", toolName: "hmdm_applications_get", description: "[read] Get an application.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/applications/{id}/versions", operation: "applicationsVersionsGet", toolName: "hmdm_applications_versions_get", description: "[read] List application versions.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/applications/configurations/{id}", operation: "applicationsConfigurationsGet", toolName: "hmdm_applications_configurations_get", description: "[read] Get application configurations.", required: ["id"] },
  { tier: "read", method: "GET", path: "/private/groups/search", operation: "groupsSearch", toolName: "hmdm_groups_search", description: "[read] Search groups." },
  { tier: "read", method: "GET", path: "/private/groups/search/{value}", operation: "groupsSearchByValue", toolName: "hmdm_groups_search_value", description: "[read] Search groups by value.", required: ["value"] },
  { tier: "read", method: "GET", path: "/private/summary/devices", operation: "summaryDevicesGet", toolName: "hmdm_summary_devices_get", description: "[read] Get device summary." },
  { tier: "read", method: "GET", path: "/private/users/current", operation: "usersCurrentGet", toolName: "hmdm_users_current_get", description: "[read] Get current user." },
  { tier: "read", method: "GET", path: "/private/users/all", operation: "usersAllGet", toolName: "hmdm_users_all_get", description: "[read] List users." },
  { tier: "read", method: "GET", path: "/private/users/roles", operation: "usersRolesGet", toolName: "hmdm_users_roles_get", description: "[read] List user roles." },
  { tier: "read", method: "GET", path: "/private/roles/all", operation: "rolesAllGet", toolName: "hmdm_roles_all_get", description: "[read] List roles." },
  { tier: "read", method: "GET", path: "/private/roles/permissions", operation: "rolesPermissionsGet", toolName: "hmdm_roles_permissions_get", description: "[read] List role permissions." },
  { tier: "read", method: "GET", path: "/private/settings", operation: "settingsGet", toolName: "hmdm_settings_get", description: "[read] Get settings." },
  { tier: "read", method: "GET", path: "/private/web-ui-files/search", operation: "webUiFilesSearch", toolName: "hmdm_web_ui_files_search", description: "[read] Search web UI files." },
  { tier: "read", method: "GET", path: "/private/web-ui-files/limit", operation: "webUiFilesLimit", toolName: "hmdm_web_ui_files_limit", description: "[read] Get web UI file storage limit." },
  { tier: "read", method: "GET", path: "/plugin/main/private/active", operation: "pluginsActiveGet", toolName: "hmdm_plugins_active_get", description: "[read] List active plugins." },
  { tier: "read", method: "GET", path: "/private/update/check", operation: "updateCheckGet", toolName: "hmdm_update_check_get", description: "[read] Check updates." },
  { tier: "read", method: "POST", path: "/plugins/audit/private/log/search", operation: "auditLogsSearch", toolName: "hmdm_audit_logs_search", description: "[read] Search audit logs.", body: { page: 1, size: 50 } },
  { tier: "read", method: "POST", path: "/plugins/devicelog/log/private/search", operation: "deviceLogsSearch", toolName: "hmdm_device_logs_search", description: "[read] Search device logs.", body: { page: 1, size: 50 } },
  { tier: "read", method: "GET", path: "/plugins/deviceinfo/deviceinfo/private/{deviceNumber}", operation: "deviceinfoDeviceGet", toolName: "hmdm_deviceinfo_device_get", description: "[read] Get device details.", required: ["deviceNumber"] },
  { tier: "read", method: "POST", path: "/plugins/messaging/private/search", operation: "messagingSearch", toolName: "hmdm_messaging_search", description: "[read] Search messages.", body: { page: 1, size: 50 } },
  { tier: "read", method: "POST", path: "/plugins/push/private/search", operation: "pushSearch", toolName: "hmdm_push_search", description: "[read] Search push messages.", body: { page: 1, size: 50 } },
  { tier: "read", method: "POST", path: "/plugins/push/private/searchTasks", operation: "pushTasksSearch", toolName: "hmdm_push_tasks_search", description: "[read] Search push tasks.", body: { page: 1, size: 50 } },
  { tier: "write", method: "PUT", path: "/private/devices", operation: "devicesUpdate", toolName: "hmdm_devices_update", description: "[write] Create or update a device.", body: { device: { id: "device-id", name: "Device" } } },
  { tier: "write", method: "POST", path: "/private/devices/{id}/description", operation: "devicesDescriptionCreate", toolName: "hmdm_devices_description_create", description: "[write] Save device description.", required: ["id"], body: { description: "Device description" } },
  { tier: "write", method: "POST", path: "/private/devices/groupBulk", operation: "devicesGroupBulk", toolName: "hmdm_devices_group_bulk", description: "[write] Update device groups in bulk.", body: { ids: [], action: "move", groups: [] } },
  { tier: "write", method: "POST", path: "/private/devices/{id}/applicationSettings", operation: "devicesApplicationSettings", toolName: "hmdm_devices_application_settings", description: "[write] Save device application settings.", required: ["id"], body: { settings: [] } },
  { tier: "write", method: "POST", path: "/private/devices/{id}/applicationSettings/notify", operation: "devicesApplicationSettingsNotify", toolName: "hmdm_devices_application_settings_notify", description: "[write] Notify devices of application updates.", required: ["id"] },
  { tier: "write", method: "PUT", path: "/private/configurations", operation: "configurationsUpdate", toolName: "hmdm_configurations_update", description: "[write] Create or update a configuration.", body: { configuration: { id: "configuration-id" } } },
  { tier: "write", method: "PUT", path: "/private/configurations/copy", operation: "configurationsCopy", toolName: "hmdm_configurations_copy", description: "[write] Copy a configuration.", body: { sourceId: "source-id", targetId: "target-id" } },
  { tier: "write", method: "PUT", path: "/private/configurations/application/upgrade", operation: "configurationsUpgrade", toolName: "hmdm_configurations_upgrade", description: "[write] Upgrade a configuration.", body: { configurationId: "configuration-id" } },
  { tier: "write", method: "PUT", path: "/private/applications/android", operation: "applicationsAndroidUpdate", toolName: "hmdm_applications_android_update", description: "[write] Update an Android application.", body: { applicationId: "application-id" } },
  { tier: "write", method: "PUT", path: "/private/applications/web", operation: "applicationsWebUpdate", toolName: "hmdm_applications_web_update", description: "[write] Update a web application.", body: { applicationId: "application-id" } },
  { tier: "write", method: "PUT", path: "/private/applications/versions", operation: "applicationsVersionsUpdate", toolName: "hmdm_applications_versions_update", description: "[write] Update an application version.", body: { applicationVersionId: "version-id" } },
  { tier: "write", method: "POST", path: "/private/applications/configurations", operation: "applicationsConfigurationsUpdate", toolName: "hmdm_applications_configurations_update", description: "[write] Update application configurations.", body: { applicationId: "application-id", configurations: [] } },
  { tier: "write", method: "PUT", path: "/private/groups", operation: "groupsUpdate", toolName: "hmdm_groups_update", description: "[write] Create or update a group.", body: { group: { id: "group-id" } } },
  { tier: "write", method: "POST", path: "/plugins/messaging/private/send", operation: "messagingSend", toolName: "hmdm_messaging_send", description: "[write] Send a message.", body: { message: { content: "Message" } } },
  { tier: "write", method: "POST", path: "/plugins/push/private/send", operation: "pushSend", toolName: "hmdm_push_send", description: "[write] Send a push message.", body: { push: { message: "Message" } } },
  { tier: "write", method: "POST", path: "/private/push", operation: "pushApiSend", toolName: "hmdm_push_api_send", description: "[write] Send a push notification.", body: { push: { message: "Message" } } },
  { tier: "write", method: "PUT", path: "/plugins/push/private/task", operation: "pushTaskUpdate", toolName: "hmdm_push_task_update", description: "[write] Save a push task.", body: { task: { id: "task-id" } } },
  { tier: "admin", method: "DELETE", path: "/private/devices/{id}", operation: "devicesDelete", toolName: "hmdm_devices_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a device permanently.", required: ["id"] },
  { tier: "admin", method: "POST", path: "/private/devices/deleteBulk", operation: "devicesDeleteBulk", toolName: "hmdm_devices_delete_bulk", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete devices in bulk permanently.", body: { ids: [] } },
  { tier: "admin", method: "DELETE", path: "/private/configurations/{id}", operation: "configurationsDelete", toolName: "hmdm_configurations_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a configuration permanently.", required: ["id"] },
  { tier: "admin", method: "DELETE", path: "/private/applications/{id}", operation: "applicationsDelete", toolName: "hmdm_applications_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete an application permanently.", required: ["id"] },
  { tier: "admin", method: "DELETE", path: "/private/applications/versions/{id}", operation: "applicationsVersionsDelete", toolName: "hmdm_applications_versions_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete an application version permanently.", required: ["id"] },
  { tier: "admin", method: "DELETE", path: "/private/groups/{id}", operation: "groupsDelete", toolName: "hmdm_groups_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a group permanently.", required: ["id"] },
  { tier: "admin", method: "DELETE", path: "/plugins/messaging/{id}", operation: "messagingDelete", toolName: "hmdm_messaging_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a message permanently.", required: ["id"] },
  { tier: "admin", method: "GET", path: "/plugins/messaging/private/purge/{days}", operation: "messagingPurge", toolName: "hmdm_messaging_purge", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Permanently delete messages older than the specified number of days.", required: ["days"] },
  { tier: "admin", method: "DELETE", path: "/plugins/push/private/{id}", operation: "pushDelete", toolName: "hmdm_push_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a push message permanently.", required: ["id"] },
  { tier: "admin", method: "GET", path: "/plugins/push/private/purge/{days}", operation: "pushPurge", toolName: "hmdm_push_purge", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Permanently delete push messages older than the specified number of days.", required: ["days"] },
  { tier: "admin", method: "DELETE", path: "/plugins/push/private/task/{id}", operation: "pushTaskDelete", toolName: "hmdm_push_task_delete", description: "⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a push task permanently.", required: ["id"] },
  { tier: "admin", method: "POST", path: "/private/settings/misc", operation: "settingsMiscUpdate", toolName: "hmdm_settings_misc_update", description: "⚠ HIGH-IMPACT [admin] Update miscellaneous device settings.", body: { settings: { misc: true } } },
];

function makeAnnotations(tier: HeadwindTier, method: HeadwindHttpMethod, toolName: string): Tool["annotations"] {
  const destructive = tier === "admin" || toolName.includes("_delete") || toolName.includes("_purge") || toolName.includes("_remove");
  return {
    title: `Headwind MDM: ${toolName}`,
    readOnlyHint: tier === "read",
    destructiveHint: destructive,
    idempotentHint: method !== "POST",
    openWorldHint: true,
  };
}

export function getAllToolSpecs(): readonly HeadwindToolSpec[] {
  return ENDPOINTS.map((endpoint) => ({
    tool: {
      name: endpoint.toolName,
      description: endpoint.description,
      inputSchema: { type: "object", properties: {}, required: endpoint.required ?? [] },
      annotations: makeAnnotations(endpoint.tier, endpoint.method, endpoint.toolName),
    },
    operation: endpoint.operation,
    tier: endpoint.tier,
    method: endpoint.method,
    path: endpoint.path,
    required: endpoint.required ?? [],
    optional: endpoint.optional ?? [],
    body: endpoint.body,
    query: endpoint.query,
  }));
}

export function getToolSpec(name: string): HeadwindToolSpec | undefined {
  return getAllToolSpecs().find((spec) => spec.tool.name === name);
}

export async function callHeadwindTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const spec = getToolSpec(name);
  if (!spec) {
    return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true };
  }
  const enabledTiers = getEnabledTiers();
  if (!enabledTiers.has(spec.tier)) {
    return { content: [{ type: "text", text: JSON.stringify({ error: `Tool ${name} requires the "${spec.tier}" tier, which is not enabled.` }) }], isError: true };
  }
  const missing = spec.required.filter((key) => args[key] === undefined || args[key] === null);
  if (missing.length > 0) {
    return { content: [{ type: "text", text: JSON.stringify({ error: `Missing required argument(s) for ${name}: ${missing.join(", ")}.` }) }], isError: true };
  }
  const pathNames = new Set(
    [...spec.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  );
  const path = spec.path.replace(/\{([^}]+)\}/g, (_match, key: string) => encodeURIComponent(String(args[key] ?? "")));
  const requestArgs = Object.fromEntries(
    Object.entries(args).filter(([key]) => !pathNames.has(key)),
  );
  const result = await executeHeadwindRequest({
    method: spec.method,
    path,
    body: spec.method === "GET" || spec.method === "DELETE" ? undefined : requestArgs,
    query: spec.method === "GET" ? requestArgs : undefined,
    credentials: getCredentials() ?? undefined,
  });
  if (!result.ok) {
    return { content: [{ type: "text", text: JSON.stringify({ error: result.error.message }) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
}

