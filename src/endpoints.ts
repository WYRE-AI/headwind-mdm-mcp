import type { EndpointSpec, ParamSpec } from "./utils/types.js";

/**
 * Single source of truth for every tool: path, method, tier, annotations and
 * the declared arguments. `tool-tiers.ts`, `schema/tiers.json` (checked by a
 * test) and the MCP tool list are all derived from this table.
 *
 * Paths are relative to `<HMDM_BASE_URL>/rest`. Request shapes were taken from
 * the upstream Java resource classes (server rest/resource and the plugins rest packages).
 * Tenant fields (`customerId`, `userId`) are not declared as top-level arguments,
 * so undeclared top-level arguments (including these) are dropped. Entity objects
 * (request bodies) are passed through with any extra fields, minus `__proto__` /
 * `constructor` / `prototype`, so a tenant field inside an entity object is NOT
 * stripped by this server; the Headwind server derives tenancy from the
 * authenticated user and must be relied on to ignore or reject it.
 */

const optional = (spec: ParamSpec): ParamSpec => ({ ...spec, optional: true });
const str = (description: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: "string", description, ...extra });
const int = (description: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: "integer", description, ...extra });
const bool = (description: string): ParamSpec => ({ type: "boolean", description });
const arr = (description: string, items: ParamSpec): ParamSpec => ({ type: "array", description, items });
const obj = (description: string, properties?: Record<string, ParamSpec>): ParamSpec => ({ type: "object", description, properties });

const ENTITY_NOTE =
  " Sent as the request body: read the entity first (get tool), change the fields you need and send it back; fields not declared here are passed through as part of the entity.";

const id = (what: string): ParamSpec => int(`${what} ID.`, { minimum: 0 });
const pageNum = optional(int("1-based page number (default 1).", { minimum: 1 }));
const pageSize = optional(int("Page size (default 50, max 1000).", { minimum: 1, maximum: 1000 }));
const epochMs = (what: string): ParamSpec => optional(int(`${what}, epoch milliseconds.`, { minimum: 0 }));

const NO_PARAMS: Record<string, ParamSpec> = {};

const PUSH_SCOPE = str("Target scope: device (needs deviceNumber), group (needs groupId), configuration (needs configurationId) or all.", {
  enum: ["device", "group", "configuration", "all"],
});
const PUSH_RISK =
  "messageType and payload are relayed verbatim to the device launcher, which can act on types such as runCommand, deleteFile, purgeDir, deleteDir, uninstallApp, reboot and clearAppData.";

export const ENDPOINTS: readonly EndpointSpec[] = [
  // ---------------------------------------------------------------- read
  {
    name: "hmdm_devices_search", tier: "read", method: "POST", path: "/private/devices/search", operation: "devicesSearch",
    description: "[read] Search devices (paginated, filterable). Read-only despite the POST verb.", destructiveHint: false,
    params: {
      value: optional(str("Free-text filter (number, description, IMEI, phone).")),
      groupId: optional(int("Only devices in this group.", { minimum: 0 })),
      configurationId: optional(int("Only devices using this configuration.", { minimum: 0 })),
      pageNum, pageSize,
      sortBy: optional(str("Sort column, e.g. NUMBER, LAST_UPDATE, STATUS, DESCRIPTION, CONFIGURATION, GROUP.")),
      sortDir: optional(str("Sort direction.", { enum: ["ASC", "DESC"] })),
      dateFrom: epochMs("Last-update lower bound"),
      dateTo: epochMs("Last-update upper bound"),
      enrollmentDateFrom: epochMs("Enrollment lower bound"),
      enrollmentDateTo: epochMs("Enrollment upper bound"),
      onlineEarlierMillis: optional(int("Only devices last online earlier than this many ms ago.", { minimum: 0 })),
      onlineLaterMillis: optional(int("Only devices last online later than this many ms ago.", { minimum: 0 })),
      mdmMode: optional(bool("Filter by MDM mode.")),
      kioskMode: optional(bool("Filter by kiosk mode.")),
      androidVersion: optional(str("Filter by Android version.")),
      launcherVersion: optional(str("Filter by launcher version.")),
      installationStatus: optional(str("Filter by app installation status.", { enum: ["SUCCESS", "VERSION_MISMATCH", "FAILURE"] })),
      imeiChanged: optional(bool("Only devices whose IMEI changed.")),
      fastSearch: optional(bool("Use the fast (less detailed) search.")),
    },
  },
  {
    name: "hmdm_devices_number_get", tier: "read", method: "GET", path: "/private/devices/number/{number}", operation: "devicesNumberGet",
    description: "[read] Get a device by its number.", destructiveHint: false,
    params: { number: str("Device number.") },
  },
  {
    name: "hmdm_devices_application_settings_get", tier: "read", method: "GET", path: "/private/devices/{id}/applicationSettings", operation: "devicesApplicationSettingsGet",
    description: "[read] Get the application settings set at device level.", destructiveHint: false,
    params: { id: id("Device") },
  },
  {
    name: "hmdm_configurations_search", tier: "read", method: "GET", path: "/private/configurations/search", operation: "configurationsSearch",
    description: "[read] List all configurations.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_configurations_list", tier: "read", method: "GET", path: "/private/configurations/list", operation: "configurationsList",
    description: "[read] List configuration names.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_configurations_search_value", tier: "read", method: "GET", path: "/private/configurations/search/{value}", operation: "configurationsSearchByValue",
    description: "[read] Search configurations by a filter value.", destructiveHint: false,
    params: { value: str("Filter value.") },
  },
  {
    name: "hmdm_configurations_get", tier: "read", method: "GET", path: "/private/configurations/{id}", operation: "configurationsGet",
    description: "[read] Get a configuration by ID.", destructiveHint: false,
    params: { id: id("Configuration") },
  },
  {
    name: "hmdm_configurations_applications_get", tier: "read", method: "GET", path: "/private/configurations/applications/{id}", operation: "configurationsApplicationsGet",
    description: "[read] Get the applications of a configuration.", destructiveHint: false,
    params: { id: id("Configuration") },
  },
  {
    name: "hmdm_applications_search", tier: "read", method: "GET", path: "/private/applications/search", operation: "applicationsSearch",
    description: "[read] List all applications.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_applications_search_value", tier: "read", method: "GET", path: "/private/applications/search/{value}", operation: "applicationsSearchByValue",
    description: "[read] Search applications by a filter value.", destructiveHint: false,
    params: { value: str("Filter value.") },
  },
  {
    name: "hmdm_applications_get", tier: "read", method: "GET", path: "/private/applications/{id}", operation: "applicationsGet",
    description: "[read] Get an application by ID.", destructiveHint: false,
    params: { id: id("Application") },
  },
  {
    name: "hmdm_applications_versions_get", tier: "read", method: "GET", path: "/private/applications/{id}/versions", operation: "applicationsVersionsGet",
    description: "[read] List the versions of an application.", destructiveHint: false,
    params: { id: id("Application") },
  },
  {
    name: "hmdm_applications_configurations_get", tier: "read", method: "GET", path: "/private/applications/configurations/{id}", operation: "applicationsConfigurationsGet",
    description: "[read] Get the configurations an application is linked to.", destructiveHint: false,
    params: { id: id("Application") },
  },
  {
    name: "hmdm_groups_search", tier: "read", method: "GET", path: "/private/groups/search", operation: "groupsSearch",
    description: "[read] List all device groups.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_groups_search_value", tier: "read", method: "GET", path: "/private/groups/search/{value}", operation: "groupsSearchByValue",
    description: "[read] Search device groups by a filter value.", destructiveHint: false,
    params: { value: str("Filter value.") },
  },
  {
    name: "hmdm_summary_devices_get", tier: "read", method: "GET", path: "/private/summary/devices", operation: "summaryDevicesGet",
    description: "[read] Get the device summary statistics.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_users_current_get", tier: "read", method: "GET", path: "/private/users/current", operation: "usersCurrentGet",
    description: "[read] Get the current user.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_users_all_get", tier: "read", method: "GET", path: "/private/users/all", operation: "usersAllGet",
    description: "[read] List users.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_users_roles_get", tier: "read", method: "GET", path: "/private/users/roles", operation: "usersRolesGet",
    description: "[read] List user roles.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_roles_all_get", tier: "read", method: "GET", path: "/private/roles/all", operation: "rolesAllGet",
    description: "[read] List roles.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_roles_permissions_get", tier: "read", method: "GET", path: "/private/roles/permissions", operation: "rolesPermissionsGet",
    description: "[read] List role permissions.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_settings_get", tier: "read", method: "GET", path: "/private/settings", operation: "settingsGet",
    description: "[read] Get the server settings.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_web_ui_files_search", tier: "read", method: "GET", path: "/private/web-ui-files/search", operation: "webUiFilesSearch",
    description: "[read] List uploaded files.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_web_ui_files_limit", tier: "read", method: "GET", path: "/private/web-ui-files/limit", operation: "webUiFilesLimit",
    description: "[read] Get the file storage limit.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_plugins_active_get", tier: "read", method: "GET", path: "/plugin/main/private/active", operation: "pluginsActiveGet",
    description: "[read] List the active plugins.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_update_check_get", tier: "read", method: "GET", path: "/private/update/check", operation: "updateCheckGet",
    description: "[read] Check for server updates.", destructiveHint: false, params: NO_PARAMS,
  },
  {
    name: "hmdm_audit_logs_search", tier: "read", method: "POST", path: "/plugins/audit/private/log/search", operation: "auditLogsSearch",
    description: "[read] Search the audit log. Read-only despite the POST verb.", destructiveHint: false,
    params: {
      pageNum, pageSize,
      messageFilter: optional(str("Filter on the log message.")),
      userFilter: optional(str("Filter on the user name.")),
      dateFrom: epochMs("Lower bound"),
      dateTo: epochMs("Upper bound"),
    },
  },
  {
    name: "hmdm_device_logs_search", tier: "read", method: "POST", path: "/plugins/devicelog/log/private/search", operation: "deviceLogsSearch",
    description: "[read] Search device logs. Read-only despite the POST verb.", destructiveHint: false,
    params: {
      pageNum, pageSize,
      deviceFilter: optional(str("Filter on the device number.")),
      messageFilter: optional(str("Filter on the log message.")),
      applicationFilter: optional(str("Filter on the application package.")),
      severity: optional(int("Minimum severity.", { minimum: 0 })),
      sortValue: optional(str("Sort column (default createTime).")),
      dateFrom: epochMs("Lower bound"),
      dateTo: epochMs("Upper bound"),
    },
  },
  {
    name: "hmdm_deviceinfo_device_get", tier: "read", method: "GET", path: "/plugins/deviceinfo/deviceinfo/private/{deviceNumber}", operation: "deviceinfoDeviceGet",
    description: "[read] Get the detailed device info (device info plugin).", destructiveHint: false,
    params: { deviceNumber: str("Device number.") },
  },
  {
    name: "hmdm_messaging_search", tier: "read", method: "POST", path: "/plugins/messaging/private/search", operation: "messagingSearch",
    description: "[read] Search sent messages. Read-only despite the POST verb.", destructiveHint: false,
    params: {
      pageNum, pageSize,
      deviceFilter: optional(str("Filter on the device number.")),
      messageFilter: optional(str("Filter on the message text.")),
      status: optional(int("Filter on the message status.", { minimum: 0 })),
      sortValue: optional(str("Sort column (default createTime).")),
      dateFrom: epochMs("Lower bound"),
      dateTo: epochMs("Upper bound"),
    },
  },
  {
    name: "hmdm_push_search", tier: "read", method: "POST", path: "/plugins/push/private/search", operation: "pushSearch",
    description: "[read] Search push messages. Read-only despite the POST verb.", destructiveHint: false,
    params: {
      pageNum, pageSize,
      deviceFilter: optional(str("Filter on the device number.")),
      messageFilter: optional(str("Filter on the message type.")),
      sortValue: optional(str("Sort column (default createTime).")),
      dateFrom: epochMs("Lower bound"),
      dateTo: epochMs("Upper bound"),
    },
  },
  {
    name: "hmdm_push_tasks_search", tier: "read", method: "POST", path: "/plugins/push/private/searchTasks", operation: "pushTasksSearch",
    description: "[read] Search scheduled push tasks. Read-only despite the POST verb.", destructiveHint: false,
    params: {
      pageNum, pageSize,
      messageFilter: optional(str("Filter on the message type.")),
      payloadFilter: optional(str("Filter on the payload.")),
      sortValue: optional(str("Sort column (default id).")),
    },
  },
  // --------------------------------------------------------------- write
  {
    name: "hmdm_devices_update", tier: "write", method: "PUT", path: "/private/devices", operation: "devicesUpdate",
    description: "[write] Create or update a device." + ENTITY_NOTE, destructiveHint: false, bodyParam: "device",
    params: {
      device: obj("Device entity. Omit id to create a device.", {
        id: optional(int("Device ID (update).", { minimum: 0 })),
        number: optional(str("Device number.")),
        description: optional(str("Description.")),
        configurationId: optional(int("Configuration ID.", { minimum: 0 })),
        imei: optional(str("IMEI.")),
        phone: optional(str("Phone number.")),
        groups: optional(arr("Groups, each {id, name}.", obj("Group reference.", { id: int("Group ID.", { minimum: 0 }) }))),
      }),
    },
  },
  {
    name: "hmdm_devices_description_create", tier: "write", method: "POST", path: "/private/devices/{id}/description", operation: "devicesDescriptionCreate",
    description: "[write] Save the description of a device.", destructiveHint: false, bodyParam: "description", bodyText: true,
    params: { id: id("Device"), description: str("New description (sent as a plain-text body).") },
  },
  {
    name: "hmdm_devices_group_bulk", tier: "write", method: "POST", path: "/private/devices/groupBulk", operation: "devicesGroupBulk",
    description: "[write] Add devices to (set) or remove them from (remove) groups in bulk.", destructiveHint: false,
    params: {
      ids: arr("Device IDs.", int("Device ID.", { minimum: 0 })),
      action: str("set adds the groups, remove removes them.", { enum: ["set", "remove"] }),
      groups: arr("Groups, each {id, name}.", obj("Group reference.", { id: int("Group ID.", { minimum: 0 }) })),
    },
  },
  {
    name: "hmdm_devices_application_settings", tier: "write", method: "POST", path: "/private/devices/{id}/applicationSettings", operation: "devicesApplicationSettings",
    description: "[write] Save the application settings of a device (replaces the device-level list).", destructiveHint: false, bodyParam: "settings",
    params: {
      id: id("Device"),
      settings: arr("Application settings, each {applicationId, name, type, value, comment, readonly, extRefId}.", obj("Application setting.", {
        applicationId: optional(int("Application ID.", { minimum: 0 })),
        name: optional(str("Setting name.")),
        value: optional(str("Setting value.")),
        comment: optional(str("Comment.")),
      })),
    },
  },
  {
    name: "hmdm_devices_application_settings_notify", tier: "write", method: "POST", path: "/private/devices/{id}/applicationSettings/notify", operation: "devicesApplicationSettingsNotify",
    description: "[write] Notify a device that its application settings changed.", destructiveHint: false,
    params: { id: id("Device") },
  },
  {
    name: "hmdm_configurations_update", tier: "write", method: "PUT", path: "/private/configurations", operation: "configurationsUpdate",
    description: "[write] Create or update a configuration." + ENTITY_NOTE, destructiveHint: false, bodyParam: "configuration",
    params: {
      configuration: obj("Configuration entity. Omit id to create one.", {
        id: optional(int("Configuration ID (update).", { minimum: 0 })),
        name: optional(str("Name.")),
        description: optional(str("Description.")),
        mainAppId: optional(int("Main application ID.", { minimum: 0 })),
        kioskMode: optional(bool("Kiosk mode.")),
        applications: optional(arr("Applications.", obj("Application link."))),
        applicationSettings: optional(arr("Application settings.", obj("Application setting."))),
        files: optional(arr("Configuration files.", obj("Configuration file."))),
      }),
    },
  },
  {
    name: "hmdm_configurations_copy", tier: "write", method: "PUT", path: "/private/configurations/copy", operation: "configurationsCopy",
    description: "[write] Copy a configuration into a new one with the given name.", destructiveHint: false,
    params: {
      id: id("Source configuration"),
      name: str("Name of the new configuration."),
      description: optional(str("Description of the new configuration.")),
    },
  },
  {
    name: "hmdm_configurations_upgrade", tier: "write", method: "PUT", path: "/private/configurations/application/upgrade", operation: "configurationsUpgrade",
    description: "[write] Upgrade an application of a configuration to its latest version.", destructiveHint: false,
    params: { configurationId: id("Configuration"), applicationId: id("Application") },
  },
  {
    name: "hmdm_applications_android_update", tier: "write", method: "PUT", path: "/private/applications/android", operation: "applicationsAndroidUpdate",
    description: "[write] Create or update an Android application." + ENTITY_NOTE, destructiveHint: false, bodyParam: "application",
    params: {
      application: obj("Application entity. Omit id to create one.", {
        id: optional(int("Application ID (update).", { minimum: 0 })),
        name: optional(str("Name.")),
        pkg: optional(str("Android package name.")),
        version: optional(str("Version name.")),
        versionCode: optional(int("Version code.", { minimum: 0 })),
        url: optional(str("APK download URL.")),
        showIcon: optional(bool("Show the icon.")),
        runAfterInstall: optional(bool("Run after install.")),
        runAtBoot: optional(bool("Run at boot.")),
      }),
    },
  },
  {
    name: "hmdm_applications_web_update", tier: "write", method: "PUT", path: "/private/applications/web", operation: "applicationsWebUpdate",
    description: "[write] Create or update a web application." + ENTITY_NOTE, destructiveHint: false, bodyParam: "application",
    params: {
      application: obj("Web application entity. Omit id to create one.", {
        id: optional(int("Application ID (update).", { minimum: 0 })),
        name: optional(str("Name.")),
        url: optional(str("Web page URL.")),
        showIcon: optional(bool("Show the icon.")),
        useKiosk: optional(bool("Use kiosk mode.")),
      }),
    },
  },
  {
    name: "hmdm_applications_versions_update", tier: "write", method: "PUT", path: "/private/applications/versions", operation: "applicationsVersionsUpdate",
    description: "[write] Create or update an application version." + ENTITY_NOTE, destructiveHint: false, bodyParam: "applicationVersion",
    params: {
      applicationVersion: obj("Application version entity. Omit id to create one.", {
        id: optional(int("Version ID (update).", { minimum: 0 })),
        applicationId: optional(int("Application ID.", { minimum: 0 })),
        version: optional(str("Version name.")),
        versionCode: optional(int("Version code.", { minimum: 0 })),
        url: optional(str("APK download URL.")),
      }),
    },
  },
  {
    name: "hmdm_applications_configurations_update", tier: "write", method: "POST", path: "/private/applications/configurations", operation: "applicationsConfigurationsUpdate",
    description: "[write] Link an application to configurations (or change the link actions).", destructiveHint: false,
    params: {
      applicationId: id("Application"),
      configurations: arr("Links, each {configurationId, applicationId, action, showIcon, remove, notify}.", obj("Application/configuration link.", {
        configurationId: optional(int("Configuration ID.", { minimum: 0 })),
        applicationId: optional(int("Application ID.", { minimum: 0 })),
        action: optional(int("Action code (0 do nothing, 1 install, 2 remove).", { minimum: 0, maximum: 2 })),
        showIcon: optional(bool("Show the icon.")),
        remove: optional(bool("Remove the link.")),
        notify: optional(bool("Notify devices.")),
      })),
    },
  },
  {
    name: "hmdm_groups_update", tier: "write", method: "PUT", path: "/private/groups", operation: "groupsUpdate",
    description: "[write] Create or rename a device group (omit id to create).", destructiveHint: false,
    params: { id: optional(int("Group ID (rename).", { minimum: 0 })), name: str("Group name.") },
  },
  {
    name: "hmdm_messaging_send", tier: "write", method: "POST", path: "/plugins/messaging/private/send", operation: "messagingSend",
    description: "[write] Send a text message to devices (messaging plugin).", destructiveHint: false,
    params: {
      scope: PUSH_SCOPE,
      deviceNumber: optional(str("Device number (scope=device).")),
      groupId: optional(int("Group ID (scope=group).", { minimum: 0 })),
      configurationId: optional(int("Configuration ID (scope=configuration).", { minimum: 0 })),
      message: str("Message text."),
    },
  },
  // ------------------------------------------------- push (admin: can act on devices)
  {
    name: "hmdm_push_send", tier: "admin", method: "POST", path: "/plugins/push/private/send", operation: "pushSend",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Send a push message to devices (push plugin). It can run commands, delete files or uninstall apps on real devices. ${PUSH_RISK}`,
    destructiveHint: true,
    params: {
      scope: PUSH_SCOPE,
      deviceNumber: optional(str("Device number (scope=device).")),
      groupId: optional(int("Group ID (scope=group).", { minimum: 0 })),
      configurationId: optional(int("Configuration ID (scope=configuration).", { minimum: 0 })),
      messageType: str("Push message type, e.g. configUpdated, runApp."),
      payload: optional(str("Message payload (JSON string for most types).")),
    },
  },
  {
    name: "hmdm_push_api_send", tier: "admin", method: "POST", path: "/private/push", operation: "pushApiSend",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Send a push message through the push API. It can run commands, delete files or uninstall apps on real devices. ${PUSH_RISK} broadcast=true targets ALL devices.`,
    destructiveHint: true,
    params: {
      messageType: str("Push message type, e.g. configUpdated, runApp."),
      payload: optional(str("Message payload (JSON string for most types).")),
      deviceNumbers: optional(arr("Target device numbers.", str("Device number."))),
      groups: optional(arr("Target group names.", str("Group name."))),
      broadcast: optional(bool("Send to every device, ignoring deviceNumbers and groups.")),
    },
  },
  {
    name: "hmdm_push_task_update", tier: "admin", method: "PUT", path: "/plugins/push/private/task", operation: "pushTaskUpdate",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Create or update a scheduled push task. It can run commands, delete files or uninstall apps on real devices, repeatedly. ${PUSH_RISK}`,
    destructiveHint: true,
    params: {
      id: optional(int("Task ID (update); omit to create.", { minimum: 0 })),
      scope: PUSH_SCOPE,
      deviceNumber: optional(str("Device number (scope=device).")),
      groupId: optional(int("Group ID (scope=group).", { minimum: 0 })),
      configurationId: optional(int("Configuration ID (scope=configuration).", { minimum: 0 })),
      messageType: str("Push message type."),
      payload: optional(str("Message payload.")),
      comment: optional(str("Comment.")),
      min: optional(str("Cron minute field.")),
      hour: optional(str("Cron hour field.")),
      day: optional(str("Cron day-of-month field.")),
      weekday: optional(str("Cron day-of-week field.")),
      month: optional(str("Cron month field.")),
    },
  },
  // ---------------------------------------------------- admin: irreversible
  {
    name: "hmdm_devices_delete", tier: "admin", method: "DELETE", path: "/private/devices/{id}", operation: "devicesDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a device permanently.`, destructiveHint: true,
    params: { id: id("Device") },
  },
  {
    name: "hmdm_devices_delete_bulk", tier: "admin", method: "POST", path: "/private/devices/deleteBulk", operation: "devicesDeleteBulk",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete devices in bulk permanently.`, destructiveHint: true,
    params: { ids: arr("IDs of the devices to delete.", int("Device ID.", { minimum: 0 })) },
  },
  {
    name: "hmdm_configurations_delete", tier: "admin", method: "DELETE", path: "/private/configurations/{id}", operation: "configurationsDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a configuration permanently.`, destructiveHint: true,
    params: { id: id("Configuration") },
  },
  {
    name: "hmdm_applications_delete", tier: "admin", method: "DELETE", path: "/private/applications/{id}", operation: "applicationsDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete an application permanently.`, destructiveHint: true,
    params: { id: id("Application") },
  },
  {
    name: "hmdm_applications_versions_delete", tier: "admin", method: "DELETE", path: "/private/applications/versions/{id}", operation: "applicationsVersionsDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete an application version permanently.`, destructiveHint: true,
    params: { id: id("Application version") },
  },
  {
    name: "hmdm_groups_delete", tier: "admin", method: "DELETE", path: "/private/groups/{id}", operation: "groupsDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a device group permanently.`, destructiveHint: true,
    params: { id: id("Group") },
  },
  {
    name: "hmdm_messaging_delete", tier: "admin", method: "DELETE", path: "/plugins/messaging/{id}", operation: "messagingDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a message permanently.`, destructiveHint: true,
    params: { id: id("Message") },
  },
  {
    name: "hmdm_messaging_purge", tier: "admin", method: "GET", path: "/plugins/messaging/private/purge/{days}", operation: "messagingPurge",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Permanently delete messages older than the specified number of days (destructive despite the GET verb).`, destructiveHint: true,
    params: { days: int("Delete messages older than this many days.", { minimum: 1 }) },
  },
  {
    name: "hmdm_push_delete", tier: "admin", method: "DELETE", path: "/plugins/push/private/{id}", operation: "pushDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a push message permanently.`, destructiveHint: true,
    params: { id: id("Push message") },
  },
  {
    name: "hmdm_push_purge", tier: "admin", method: "GET", path: "/plugins/push/private/purge/{days}", operation: "pushPurge",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Permanently delete push messages older than the specified number of days (destructive despite the GET verb).`, destructiveHint: true,
    params: { days: int("Delete push messages older than this many days.", { minimum: 1 }) },
  },
  {
    name: "hmdm_push_task_delete", tier: "admin", method: "DELETE", path: "/plugins/push/private/task/{id}", operation: "pushTaskDelete",
    description: `⚠ DESTRUCTIVE — IRREVERSIBLE [admin] Delete a scheduled push task permanently.`, destructiveHint: true,
    params: { id: id("Push task") },
  },
  // ------------------------------------------- admin: access / security settings
  {
    name: "hmdm_settings_misc_update", tier: "admin", method: "POST", path: "/private/settings/misc", operation: "settingsMiscUpdate",
    description:
      "⚠ HIGH-IMPACT [admin] Update the miscellaneous server settings: password-reset policy, password length/strength, idle logout and automatic enrollment of new devices (access and security settings). Every field is written, so omitted fields are reset: read hmdm_settings_get first and send all values.",
    destructiveHint: true,
    params: {
      createNewDevices: optional(bool("Automatically enroll unknown devices (single-customer installs only).")),
      newDeviceGroupId: optional(int("Group for auto-enrolled devices.", { minimum: 0 })),
      newDeviceConfigurationId: optional(int("Configuration for auto-enrolled devices.", { minimum: 0 })),
      phoneNumberFormat: optional(str("Phone number format.")),
      sendDescription: optional(bool("Send the device description to the device.")),
      passwordReset: optional(bool("Allow password reset by e-mail.")),
      passwordLength: optional(int("Minimum password length.", { minimum: 0 })),
      passwordStrength: optional(int("Password strength requirement.", { minimum: 0 })),
      idleLogout: optional(int("Idle logout in seconds.", { minimum: 0 })),
    },
  },
];
