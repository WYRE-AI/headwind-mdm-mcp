# Headwind MDM MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-server-8A2BE2.svg)](https://modelcontextprotocol.io/)

This repository contains a [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes selected [Headwind MDM](https://h-mdm.com) REST API operations to MCP-compatible clients.

The server is an independent MIT-licensed client of the Headwind MDM REST API. It does not copy or bundle Headwind MDM server code.

## Upstream license

The Headwind MDM server is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html) (`h-mdm/hmdm-server`).

This MCP server is licensed under the MIT License and is distributed as an independent client. The Apache-2.0 and MIT licenses are compatible. No Headwind MDM source code is copied into this repository; the endpoint list was derived from the public Headwind source.

Upstream contributions to the Headwind MDM server follow its [CLA/CONTRIBUTING](https://github.com/h-mdm/hmdm-server) process. Please ask before contributing to this MCP repository or upstream.

## Configuration

Copy [`.env.example`](.env.example) and set the following environment variables:

| Variable | Description |
| --- | --- |
| `HMDM_BASE_URL` | **Required, no default.** Headwind MDM server root, for example `https://mdm.example.com` (or `https://host/hmdm` when deployed under a context path). `/rest` is appended unless the value already ends with it. |
| `HMDM_USERNAME` | Headwind MDM username (`AUTH_MODE=env`). |
| `HMDM_PASSWORD` | Headwind MDM password (`AUTH_MODE=env`). |
| `HMDM_TOOL_TIERS` | Comma-separated `read`, `write`, or `admin`. Defaults to `read`. |
| `AUTH_MODE` | `env` (default) or `gateway`. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `MCP_HTTP_PORT` | HTTP port (default `8080`). |
| `MCP_HTTP_HOST` | HTTP bind host (default `127.0.0.1`; the container image sets `0.0.0.0`). |
| `CONDUIT_S2S_SECRET` | Gateway service-to-service secret. **Required for HTTP**, at least 32 characters (`openssl rand -hex 32`). Placeholders (`changeme`, `your-secret...`, `replace-with...`, only `x` or `0` characters, ...) are refused. The value is never logged. |
| `MCP_ALLOW_INSECURE_DEV` | Set to `1` to allow an **empty** `CONDUIT_S2S_SECRET` for local development only: S2S authentication is disabled and the server listens on `127.0.0.1` only. A short or placeholder secret is still refused. |
| `MCP_ALLOWED_HOSTS` | Comma-separated extra `Host` header values (hostnames or bracketed IPv6, **no port**) accepted on every endpoint except `/health`, as DNS-rebinding protection. `localhost`, `127.0.0.1` and `[::1]` are always allowed. When set, or when bound to loopback / running without an S2S secret, other hosts get `403`. Entries with a port or an unbracketed IPv6 address log a warning and never match. |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error`. |

### Base URL

`HMDM_BASE_URL` is required. In **HTTP transport** the server exits with status 1 at startup (`HMDM_BASE_URL is required ...`) when it is unset. In **stdio** the server still starts and lists its tools, but every tool call returns an error with that message until it is set.

The value is operator-configured, so any `https` host is accepted, including private and internal addresses (for example `https://10.0.0.5:8443`). `http` is accepted only for `localhost` and `127.0.0.1`. Userinfo (`user:pass@`), query strings and fragments are rejected. Redirects are never followed.

### Authentication modes

- **`AUTH_MODE=env`** (default): `HMDM_USERNAME` and `HMDM_PASSWORD` from the environment.
- **`AUTH_MODE=gateway`** (HTTP only in practice): the gateway sends per-user credentials in the `X-HMDM-Username` and `X-HMDM-Password` headers on **every** `/mcp` request. A request without both headers gets `401`. Gateway mode **never** falls back to `HMDM_USERNAME` / `HMDM_PASSWORD`: a tool call without request-scoped credentials is an error. Every request must also carry a valid `X-Gateway-S2S` proof.

The server logs in through the Headwind MDM public JWT endpoint, sends the MD5 digest of the password as an uppercase hexadecimal string, and caches the bearer token in memory for 20 minutes. The cache is keyed by a SHA-256 digest of (base URL, username, password), holds at most 100 entries (least recently used evicted, expired entries swept), and is never shared between different credentials. A `401` triggers exactly one re-login and one retry; a second `401` is returned as an authentication error. The password, its MD5 and the token are never logged or echoed: upstream error text and response data are redacted first and only then truncated (2000 characters for errors).

## Usage

```bash
npm install
npm run build
npm start
```

For HTTP transport, set `MCP_TRANSPORT=http`, `HMDM_BASE_URL`, `CONDUIT_S2S_SECRET`, and `AUTH_MODE=gateway` or `AUTH_MODE=env`. Requests to `/mcp` are limited to 1 MiB (`413` above that).

## Tool tiers

The server exposes exactly 61 tools: 32 read, 14 write, and 15 admin. `HMDM_TOOL_TIERS` controls which tiers are listed and callable (default `read`).

| Tier | Count | Policy |
| --- | --- | --- |
| `read` | 32 | Searches, lookups and listings (including the search endpoints that use `POST`). |
| `write` | 14 | Reversible changes: devices, configurations, applications, groups, text messages. |
| `admin` | 15 | Only irreversible actions and access/security changes. |

The 15 `admin` tools:

- **Irreversible deletes and purges (11):** `hmdm_devices_delete`, `hmdm_devices_delete_bulk`, `hmdm_configurations_delete`, `hmdm_applications_delete`, `hmdm_applications_versions_delete`, `hmdm_groups_delete`, `hmdm_messaging_delete`, `hmdm_messaging_purge`, `hmdm_push_delete`, `hmdm_push_purge`, `hmdm_push_task_delete`.
- **Push messages that act on real devices (3):** `hmdm_push_send`, `hmdm_push_api_send`, `hmdm_push_task_update`. The server relays `messageType` and `payload` verbatim to the device launcher, which can run commands, delete files, purge directories, uninstall apps, reboot or clear app data.
- **Access/security settings (1):** `hmdm_settings_misc_update` changes the password-reset policy, password length/strength, idle logout and automatic enrollment of new devices.

Tool arguments are declared in each tool's `inputSchema`. Only declared arguments are forwarded; anything else is dropped. Path parameters are validated (no empty value, `.`, `..`, `/`, `\` or control characters) and URL-encoded. Entity payloads (`device`, `configuration`, `application`, `applicationVersion`) are objects whose declared key fields are type-checked; other entity fields are passed through so that a record read with a `get` tool can be sent back unchanged.

## Security

- `HMDM_BASE_URL` is required, must use HTTPS (HTTP only for `localhost` / `127.0.0.1`), and must not contain userinfo, a query or a fragment. Any https host is allowed because the URL is operator-set.
- Redirects are not followed.
- HTTP transport refuses to start without a real `CONDUIT_S2S_SECRET` (at least 32 characters, not a placeholder) unless `MCP_ALLOW_INSECURE_DEV=1` (loopback only, empty secret only).
- `Host` header check (`MCP_ALLOWED_HOSTS`), `X-Gateway-S2S` verification and a 1 MiB body limit run before any Headwind credential is read.
- Gateway mode never reads credentials from the environment.

## Development

```bash
npm ci
npm run build
npm test
npm run lint
npm run lint:destructive
npm run smoke
```

The smoke test uses a local mock and performs no external network calls.
