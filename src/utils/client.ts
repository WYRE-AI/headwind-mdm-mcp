import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HeadwindCredentials, HeadwindClientResult, HeadwindHttpMethod } from "./types.js";

export const DEFAULT_BASE_URL = "https://mdm.example.com/rest";
export const LOGIN_PATH = "/public/jwt/login";
export const PRIVATE_PREFIX = "/private";
export const PLUGIN_PREFIX = "/plugins";
export const GATEWAY_USERNAME_HEADER = "x-hmdm-username";
export const GATEWAY_PASSWORD_HEADER = "x-hmdm-password";
export const TOKEN_TTL_MS = 20 * 60 * 1000;

const MAX_CREDENTIAL_LENGTH = 512;

const credentialStore = new AsyncLocalStorage<HeadwindCredentials>();

export function runWithCredentials<T>(credentials: HeadwindCredentials, fn: () => T): T {
  return credentialStore.run(credentials, fn);
}

export function getCredentials(env: NodeJS.ProcessEnv = process.env): HeadwindCredentials | null {
  const scoped = credentialStore.getStore();
  if (scoped) return scoped;
  if (env.AUTH_MODE === "gateway") return null;
  const username = (env.HMDM_USERNAME ?? env.HMDM_LOGIN ?? "").trim();
  const password = (env.HMDM_PASSWORD ?? env.HMDM_PASS ?? "").trim();
  if (!username || !password) return null;
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) return null;
  return { username, password };
}

export function resolveGatewayCredentials(getHeader: (name: string) => string | undefined): {
  credentials?: HeadwindCredentials;
  error?: string;
} {
  const username = typeof getHeader(GATEWAY_USERNAME_HEADER) === "string" ? getHeader(GATEWAY_USERNAME_HEADER)!.trim() : "";
  const password = typeof getHeader(GATEWAY_PASSWORD_HEADER) === "string" ? getHeader(GATEWAY_PASSWORD_HEADER)!.trim() : "";
  if (!username || !password) {
    return { error: "Missing X-HMDM-Username or X-HMDM-Password header in gateway mode." };
  }
  return { credentials: { username, password } };
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((accumulator, secret) => (secret ? accumulator.split(secret).join("[redacted]") : accumulator), value);
}

function md5Uppercase(value: string): string {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}

function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return "";
  return token;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export function resetAuthStateForTests(): void {
  tokenCache = null;
}

function isTokenExpired(now: number = Date.now()): boolean {
  return !tokenCache || tokenCache.expiresAt <= now;
}

async function loginInternal(credentials: HeadwindCredentials): Promise<string> {
  const passwordMd5 = md5Uppercase(credentials.password);
  const response = await fetch(`${getBaseUrl()}${LOGIN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login: credentials.username, password: passwordMd5 }),
    redirect: "manual",
  });
  const bodyText = await response.text();
  const body = safeJson(bodyText);
  const token = response.ok ? extractBearerToken(response.headers.get("authorization")) : "";
  const tokenFromBody = isRecord(body) && typeof body.id_token === "string" ? body.id_token : "";
  const accessToken = token || tokenFromBody;
  if (!response.ok || !accessToken) {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : "Authentication failed.";
    throw Object.assign(new Error(redactSecrets(message, [credentials.password, passwordMd5, accessToken])), {
      kind: "auth",
    });
  }
  tokenCache = { token: accessToken, expiresAt: Date.now() + TOKEN_TTL_MS };
  return accessToken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function getAccessToken(credentials: HeadwindCredentials): Promise<string> {
  if (!isTokenExpired()) {
    if (!tokenCache) throw Object.assign(new Error("Headwind MDM access token is not initialized."), { kind: "auth" });
    return tokenCache.token;
  }
  const token = await loginInternal(credentials);
  return token;
}

export async function executeHeadwindRequest(input: {
  method: HeadwindHttpMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  credentials?: HeadwindCredentials;
}): Promise<HeadwindClientResult> {
  const credentials = input.credentials ?? getCredentials();
  if (!credentials) {
    return { ok: false, error: { kind: "auth", message: "Missing Headwind MDM credentials. Set HMDM_USERNAME and HMDM_PASSWORD." } };
  }
  if (input.path === LOGIN_PATH) {
    const token = await loginInternal(credentials);
    return { ok: true, data: { token } };
  }

  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}${input.path}`);
  if (input.query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) search.append(key, String(item));
      } else {
        search.set(key, String(value));
      }
    }
    url.search = search.toString();
  }

  const requiresAuth = input.path.startsWith(`${PRIVATE_PREFIX}/`) || input.path.startsWith(`${PLUGIN_PREFIX}/`);
  let token = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    token = requiresAuth ? await getAccessToken(credentials) : "";
    response = await fetch(url, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: input.body && input.method !== "GET" && input.method !== "DELETE" ? JSON.stringify(input.body) : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: { kind: "timeout", message: "Headwind MDM request timed out after 30 seconds." } };
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { kind: "network", message: redactSecrets(rawMessage, [credentials.password, token]) } };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    tokenCache = null;
    const retriedToken = await getAccessToken(credentials);
    const retryController = new AbortController();
    const retryTimer = setTimeout(() => retryController.abort(), 30_000);
    try {
      response = await fetch(url, {
        method: input.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${retriedToken}`,
        },
        body: input.body && input.method !== "GET" && input.method !== "DELETE" ? JSON.stringify(input.body) : undefined,
        redirect: "manual",
        signal: retryController.signal,
      });
    } finally {
      clearTimeout(retryTimer);
    }
  }

  if (response.status === 401) {
    return { ok: false, error: { kind: "auth", message: "Headwind MDM authentication failed. Re-login required." } };
  }
  if (response.status >= 300) {
    return { ok: false, error: { kind: "http", message: `Headwind MDM request failed with HTTP status ${response.status}.` } };
  }
  const body = safeJson(await response.text());
  if (isRecord(body) && body.status === "ERROR") {
    return {
      ok: false,
      error: {
        kind: "upsert",
        message: redactSecrets(typeof body.message === "string" ? body.message : "Headwind MDM operation returned an error.", [
          credentials.password,
          token,
        ]),
      },
    };
  }
  if (!isRecord(body) || body.status !== "OK") {
    return { ok: false, error: { kind: "http", message: "Headwind MDM response was missing a valid status envelope." } };
  }
  return { ok: true, data: isRecord(body.data) ? body.data : {} };
}

export function getBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.HMDM_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid HMDM_BASE_URL: not a valid URL.");
  }
  const fail = (): never => {
    throw new Error("Invalid HMDM_BASE_URL: HTTPS is required, except HTTP for localhost in tests, and userinfo is not allowed.");
  };
  if (parsed.username || parsed.password || parsed.hash) fail();
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) fail();
  return `${parsed.toString().replace(/\/$/, "")}/rest`;
}

export function resolveBaseUrl(raw?: string): string {
  const value = (raw ?? "").trim() || DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid HMDM_BASE_URL: not a valid URL.");
  }
  const fail = (): never => {
    throw new Error("Invalid HMDM_BASE_URL: HTTPS is required, except HTTP for localhost in tests, and userinfo is not allowed.");
  };
  if (parsed.username || parsed.password || parsed.hash) fail();
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) fail();
  return `${parsed.toString().replace(/\/$/, "")}/rest`;
}
