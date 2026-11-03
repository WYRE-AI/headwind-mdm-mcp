import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type ToolTier = "read" | "write" | "admin";

export interface ToolTierEntry {
  tier: ToolTier;
  pendingAaron: boolean;
  note: string;
  operation: string;
}

export const TOOL_OPERATIONS: Record<string, string> = {
  hmdm_devices_search: "devicesSearch",
  hmdm_devices_number_get: "devicesNumberGet",
  hmdm_devices_application_settings_get: "devicesApplicationSettingsGet",
  hmdm_configurations_search: "configurationsSearch",
  hmdm_configurations_list: "configurationsList",
  hmdm_configurations_search_value: "configurationsSearchByValue",
  hmdm_configurations_get: "configurationsGet",
  hmdm_configurations_applications_get: "configurationsApplicationsGet",
  hmdm_applications_search: "applicationsSearch",
  hmdm_applications_search_value: "applicationsSearchByValue",
  hmdm_applications_get: "applicationsGet",
  hmdm_applications_versions_get: "applicationsVersionsGet",
  hmdm_applications_configurations_get: "applicationsConfigurationsGet",
  hmdm_groups_search: "groupsSearch",
  hmdm_groups_search_value: "groupsSearchByValue",
  hmdm_summary_devices_get: "summaryDevicesGet",
  hmdm_users_current_get: "usersCurrentGet",
  hmdm_users_all_get: "usersAllGet",
  hmdm_users_roles_get: "usersRolesGet",
  hmdm_roles_all_get: "rolesAllGet",
  hmdm_roles_permissions_get: "rolesPermissionsGet",
  hmdm_settings_get: "settingsGet",
  hmdm_web_ui_files_search: "webUiFilesSearch",
  hmdm_web_ui_files_limit: "webUiFilesLimit",
  hmdm_plugins_active_get: "pluginsActiveGet",
  hmdm_update_check_get: "updateCheckGet",
  hmdm_audit_logs_search: "auditLogsSearch",
  hmdm_device_logs_search: "deviceLogsSearch",
  hmdm_deviceinfo_device_get: "deviceinfoDeviceGet",
  hmdm_messaging_search: "messagingSearch",
  hmdm_push_search: "pushSearch",
  hmdm_push_tasks_search: "pushTasksSearch",
  hmdm_devices_update: "devicesUpdate",
  hmdm_devices_description_create: "devicesDescriptionCreate",
  hmdm_devices_group_bulk: "devicesGroupBulk",
  hmdm_devices_application_settings: "devicesApplicationSettings",
  hmdm_devices_application_settings_notify: "devicesApplicationSettingsNotify",
  hmdm_configurations_update: "configurationsUpdate",
  hmdm_configurations_copy: "configurationsCopy",
  hmdm_configurations_upgrade: "configurationsUpgrade",
  hmdm_applications_android_update: "applicationsAndroidUpdate",
  hmdm_applications_web_update: "applicationsWebUpdate",
  hmdm_applications_versions_update: "applicationsVersionsUpdate",
  hmdm_applications_configurations_update: "applicationsConfigurationsUpdate",
  hmdm_groups_update: "groupsUpdate",
  hmdm_messaging_send: "messagingSend",
  hmdm_push_send: "pushSend",
  hmdm_push_api_send: "pushApiSend",
  hmdm_push_task_update: "pushTaskUpdate",
  hmdm_devices_delete: "devicesDelete",
  hmdm_devices_delete_bulk: "devicesDeleteBulk",
  hmdm_configurations_delete: "configurationsDelete",
  hmdm_applications_delete: "applicationsDelete",
  hmdm_applications_versions_delete: "applicationsVersionsDelete",
  hmdm_groups_delete: "groupsDelete",
  hmdm_messaging_delete: "messagingDelete",
  hmdm_messaging_purge: "messagingPurge",
  hmdm_push_delete: "pushDelete",
  hmdm_push_purge: "pushPurge",
  hmdm_push_task_delete: "pushTaskDelete",
  hmdm_settings_misc_update: "settingsMiscUpdate",
};

export const TOOL_TIERS: Record<string, ToolTierEntry> = {
  hmdm_devices_search: { tier: "read", pendingAaron: false, note: "", operation: "devicesSearch" },
  hmdm_devices_number_get: { tier: "read", pendingAaron: false, note: "", operation: "devicesNumberGet" },
  hmdm_devices_application_settings_get: { tier: "read", pendingAaron: false, note: "", operation: "devicesApplicationSettingsGet" },
  hmdm_configurations_search: { tier: "read", pendingAaron: false, note: "", operation: "configurationsSearch" },
  hmdm_configurations_list: { tier: "read", pendingAaron: false, note: "", operation: "configurationsList" },
  hmdm_configurations_search_value: { tier: "read", pendingAaron: false, note: "", operation: "configurationsSearchByValue" },
  hmdm_configurations_get: { tier: "read", pendingAaron: false, note: "", operation: "configurationsGet" },
  hmdm_configurations_applications_get: { tier: "read", pendingAaron: false, note: "", operation: "configurationsApplicationsGet" },
  hmdm_applications_search: { tier: "read", pendingAaron: false, note: "", operation: "applicationsSearch" },
  hmdm_applications_search_value: { tier: "read", pendingAaron: false, note: "", operation: "applicationsSearchByValue" },
  hmdm_applications_get: { tier: "read", pendingAaron: false, note: "", operation: "applicationsGet" },
  hmdm_applications_versions_get: { tier: "read", pendingAaron: false, note: "", operation: "applicationsVersionsGet" },
  hmdm_applications_configurations_get: { tier: "read", pendingAaron: false, note: "", operation: "applicationsConfigurationsGet" },
  hmdm_groups_search: { tier: "read", pendingAaron: false, note: "", operation: "groupsSearch" },
  hmdm_groups_search_value: { tier: "read", pendingAaron: false, note: "", operation: "groupsSearchByValue" },
  hmdm_summary_devices_get: { tier: "read", pendingAaron: false, note: "", operation: "summaryDevicesGet" },
  hmdm_users_current_get: { tier: "read", pendingAaron: false, note: "", operation: "usersCurrentGet" },
  hmdm_users_all_get: { tier: "read", pendingAaron: false, note: "", operation: "usersAllGet" },
  hmdm_users_roles_get: { tier: "read", pendingAaron: false, note: "", operation: "usersRolesGet" },
  hmdm_roles_all_get: { tier: "read", pendingAaron: false, note: "", operation: "rolesAllGet" },
  hmdm_roles_permissions_get: { tier: "read", pendingAaron: false, note: "", operation: "rolesPermissionsGet" },
  hmdm_settings_get: { tier: "read", pendingAaron: false, note: "", operation: "settingsGet" },
  hmdm_web_ui_files_search: { tier: "read", pendingAaron: false, note: "", operation: "webUiFilesSearch" },
  hmdm_web_ui_files_limit: { tier: "read", pendingAaron: false, note: "", operation: "webUiFilesLimit" },
  hmdm_plugins_active_get: { tier: "read", pendingAaron: false, note: "", operation: "pluginsActiveGet" },
  hmdm_update_check_get: { tier: "read", pendingAaron: false, note: "", operation: "updateCheckGet" },
  hmdm_audit_logs_search: { tier: "read", pendingAaron: false, note: "", operation: "auditLogsSearch" },
  hmdm_device_logs_search: { tier: "read", pendingAaron: false, note: "", operation: "deviceLogsSearch" },
  hmdm_deviceinfo_device_get: { tier: "read", pendingAaron: false, note: "", operation: "deviceinfoDeviceGet" },
  hmdm_messaging_search: { tier: "read", pendingAaron: false, note: "", operation: "messagingSearch" },
  hmdm_push_search: { tier: "read", pendingAaron: false, note: "", operation: "pushSearch" },
  hmdm_push_tasks_search: { tier: "read", pendingAaron: false, note: "", operation: "pushTasksSearch" },
  hmdm_devices_update: { tier: "write", pendingAaron: false, note: "", operation: "devicesUpdate" },
  hmdm_devices_description_create: { tier: "write", pendingAaron: false, note: "", operation: "devicesDescriptionCreate" },
  hmdm_devices_group_bulk: { tier: "write", pendingAaron: false, note: "", operation: "devicesGroupBulk" },
  hmdm_devices_application_settings: { tier: "write", pendingAaron: false, note: "", operation: "devicesApplicationSettings" },
  hmdm_devices_application_settings_notify: { tier: "write", pendingAaron: false, note: "", operation: "devicesApplicationSettingsNotify" },
  hmdm_configurations_update: { tier: "write", pendingAaron: false, note: "", operation: "configurationsUpdate" },
  hmdm_configurations_copy: { tier: "write", pendingAaron: false, note: "", operation: "configurationsCopy" },
  hmdm_configurations_upgrade: { tier: "write", pendingAaron: false, note: "", operation: "configurationsUpgrade" },
  hmdm_applications_android_update: { tier: "write", pendingAaron: false, note: "", operation: "applicationsAndroidUpdate" },
  hmdm_applications_web_update: { tier: "write", pendingAaron: false, note: "", operation: "applicationsWebUpdate" },
  hmdm_applications_versions_update: { tier: "write", pendingAaron: false, note: "", operation: "applicationsVersionsUpdate" },
  hmdm_applications_configurations_update: { tier: "write", pendingAaron: false, note: "", operation: "applicationsConfigurationsUpdate" },
  hmdm_groups_update: { tier: "write", pendingAaron: false, note: "", operation: "groupsUpdate" },
  hmdm_messaging_send: { tier: "write", pendingAaron: false, note: "", operation: "messagingSend" },
  hmdm_push_send: { tier: "write", pendingAaron: false, note: "", operation: "pushSend" },
  hmdm_push_api_send: { tier: "write", pendingAaron: false, note: "", operation: "pushApiSend" },
  hmdm_push_task_update: { tier: "write", pendingAaron: false, note: "", operation: "pushTaskUpdate" },
  hmdm_devices_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "devicesDelete" },
  hmdm_devices_delete_bulk: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "devicesDeleteBulk" },
  hmdm_configurations_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "configurationsDelete" },
  hmdm_applications_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "applicationsDelete" },
  hmdm_applications_versions_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "applicationsVersionsDelete" },
  hmdm_groups_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "groupsDelete" },
  hmdm_messaging_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "messagingDelete" },
  hmdm_messaging_purge: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "messagingPurge" },
  hmdm_push_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "pushDelete" },
  hmdm_push_purge: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "pushPurge" },
  hmdm_push_task_delete: { tier: "admin", pendingAaron: true, note: "Irreversible", operation: "pushTaskDelete" },
  hmdm_settings_misc_update: { tier: "admin", pendingAaron: true, note: "High impact", operation: "settingsMiscUpdate" },
};

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
  const entry = TOOL_TIERS[toolName];
  return entry?.tier === "admin" || /_(delete|purge|remove)$/.test(toolName);
}

export function toolAnnotation(tool: Tool): Tool["annotations"] {
  const tier = TOOL_TIERS[tool.name]?.tier ?? "read";
  const destructive = tier === "admin" || /_(delete|purge|remove)$/.test(tool.name);
  return {
    title: `Headwind MDM: ${tool.name}`,
    readOnlyHint: tier === "read",
    destructiveHint: destructive,
    idempotentHint: !/^(POST|PUT|PATCH)$/.test(tool.name) ? true : false,
    openWorldHint: true,
  };
}
