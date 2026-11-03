# Changelog

## [Unreleased]

### Added

- Headwind MDM MCP server with 61 tiered REST tools.
- JWT authentication, bearer-token caching, refresh, and 401 retry handling.
- Stdio and gateway HTTP transports.
- Read, write, and admin tool tiers.
- Mocked unit and smoke tests.

### Security

- `HMDM_BASE_URL` is now required (no placeholder default). HTTP transport exits at startup without it; stdio starts and every tool call returns an error. `/rest` is appended only when missing (previously a default of `.../rest` produced `/rest/rest`).
- Token cache is per credential (SHA-256 keyed, capped at 100, LRU with expiry sweep) instead of one global token shared by all gateway users.
- Gateway mode never falls back to environment credentials; request-scoped credentials come from `X-HMDM-Username` / `X-HMDM-Password`.
- `CONDUIT_S2S_SECRET` must be at least 32 characters and not a placeholder (including all-`x` / all-`0` values).
- `MCP_ALLOWED_HOSTS` Host-header (DNS rebinding) check and a 1 MiB `/mcp` body limit (413).
- Real per-tool `inputSchema` declared from the upstream API; only declared arguments are forwarded, nested `__proto__` / `constructor` keys are dropped, and path parameters are validated and encoded.
- Upstream errors and data are redacted (password, MD5, tokens, Authorization values) before truncation; a 401 gets exactly one re-login and retry.
- All authenticated paths (including `/plugin/main/private/active`) always send the bearer token; array `data` payloads are no longer dropped.
- Tier policy: `hmdm_push_send`, `hmdm_push_api_send` and `hmdm_push_task_update` moved from `write` to `admin` (they can run commands, delete files or uninstall apps on devices). Counts are now 32 read / 14 write / 15 admin.
- Dockerfile pinned to `node:22-alpine` by digest; `.dockerignore` added; `mcp-assert` workflow declares least-privilege permissions; image is published as `ghcr.io/wyre-ai/headwind-mdm-mcp`.
