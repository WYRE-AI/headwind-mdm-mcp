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
| `HMDM_BASE_URL` | Headwind MDM REST base URL, for example `https://mdm.example.com`. |
| `HMDM_USERNAME` | Headwind MDM username. |
| `HMDM_PASSWORD` | Headwind MDM password. |
| `HMDM_TOOL_TIERS` | Comma-separated `read`, `write`, or `admin`. Defaults to `read`. |
| `AUTH_MODE` | `env` or `gateway`. |
| `MCP_TRANSPORT` | `stdio` or `http`. |
| `MCP_HTTP_PORT` | HTTP port. |
| `MCP_HTTP_HOST` | HTTP bind host. |
| `MCP_ALLOW_INSECURE_DEV` | Local-only escape hatch for an empty gateway secret. |
| `CONDUIT_S2S_SECRET` | Gateway service-to-service secret. |
| `LOG_LEVEL` | Log level. |

The stdio transport reads `HMDM_USERNAME` and `HMDM_PASSWORD`. Gateway mode reads per-user credentials from `X-HMDM-Username` and `X-HMDM-Password` headers.

## Authentication

The server logs in through the Headwind MDM public JWT endpoint, sends the MD5 digest of the password as an uppercase hexadecimal string, caches the bearer token in memory, refreshes it after 20 minutes, and retries once after a private or plugin endpoint returns 401.

The bearer token is never logged or echoed. Credential-bearing errors are redacted.

## Usage

```bash
npm install
npm run build
npm start
```

For HTTP transport, set `MCP_TRANSPORT=http`, provide `CONDUIT_S2S_SECRET`, and set `AUTH_MODE=gateway` or `AUTH_MODE=env`.

## Tool tiers

The server exposes exactly 61 tools: 32 read, 17 write, and 12 admin tools. `HMDM_TOOL_TIERS` controls the default visibility:

- `read` — 32 tools
- `write` — 17 tools
- `admin` — 12 tools

The default is `read`.

## Security

- `HMDM_BASE_URL` must use HTTPS, except HTTP for `localhost` or `127.0.0.1` in tests.
- Userinfo is rejected.
- Redirects are not followed.
- Gateway mode uses service-to-service authentication.

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
