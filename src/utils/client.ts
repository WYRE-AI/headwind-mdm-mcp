import { createHash, createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  BuiltRequest,
  EndpointSpec,
  HeadwindClientError,
  HeadwindClientResult,
  HeadwindCredentials,
  ParamSpec,
} from "./types.js";

export const LOGIN_PATH = "/public/jwt/login";
export const PUBLIC_PREFIX = "/public/";
export const GATEWAY_USERNAME_HEADER = "x-hmdm-username";
export const GATEWAY_PASSWORD_HEADER = "x-hmdm-password";
export const TOKEN_TTL_MS = 20 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_TOKEN_CACHE = 100;
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_RESPONSE_CHARS = 10_000_000;

const MAX_CREDENTIAL_LENGTH = 512;
const MAX_NESTING_DEPTH = 20;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Thrown for invalid tool input; surfaced to the model as a tool error. */
export class InputError extends Error {}

/** Thrown inside the client for upstream failures; converted to a result. */
class HeadwindError extends Error {
  constructor(
    readonly kind: "auth" | "http" | "timeout" | "network",
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

/**
 * Validate HMDM_BASE_URL and return the REST root (always ending in /rest).
 *
 * HMDM_BASE_URL is the server root (for example https://mdm.example.com, or
 * https://host/hmdm when the app is deployed under a context path). "/rest" is
 * appended unless the value already ends in it. The URL is operator-set: any
 * https host is accepted (private and internal addresses included); http is
 * only accepted for localhost / 127.0.0.1. Userinfo, query strings and
 * fragments are rejected. There is no default.
 */
export function resolveBaseUrl(raw?: string): string {
  const value = (raw ?? "").trim();
  if (!value) throw new Error("HMDM_BASE_URL is required (for example https://mdm.example.com).");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid HMDM_BASE_URL: not a valid URL.");
  }
  if (url.username || url.password) throw new Error("Invalid HMDM_BASE_URL: userinfo is not allowed.");
  if (url.hash || url.search || value.includes("#") || value.includes("?")) {
    throw new Error("Invalid HMDM_BASE_URL: query strings and fragments are not allowed.");
  }
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error("Invalid HMDM_BASE_URL: http is only allowed for localhost and 127.0.0.1.");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("Invalid HMDM_BASE_URL: only https is allowed (http only for localhost and 127.0.0.1).");
  }
  if (!url.hostname) throw new Error("Invalid HMDM_BASE_URL: hostname is required.");
  let path = url.pathname.replace(/\/+$/, "");
  if (!/\/rest$/.test(path)) path += "/rest";
  return `${url.origin}${path}`;
}

export function getBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBaseUrl(env.HMDM_BASE_URL);
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const credentialStore = new AsyncLocalStorage<HeadwindCredentials>();

export function runWithCredentials<T>(credentials: HeadwindCredentials, fn: () => T): T {
  return credentialStore.run(credentials, fn);
}

export function isGatewayAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AUTH_MODE ?? "").trim() === "gateway";
}

/**
 * Read credentials. With a header getter (gateway mode) they come ONLY from the
 * X-HMDM-Username / X-HMDM-Password headers (lowercase lookup) and the
 * environment is never consulted; otherwise from HMDM_USERNAME / HMDM_PASSWORD.
 */
export function getCredentials(
  env: NodeJS.ProcessEnv = process.env,
  getHeader?: (name: string) => string | undefined,
): HeadwindCredentials | { error: string } {
  let username: string;
  let password: string;
  if (getHeader) {
    username = (getHeader(GATEWAY_USERNAME_HEADER) ?? "").trim();
    password = (getHeader(GATEWAY_PASSWORD_HEADER) ?? "").trim();
    if (!username || !password) {
      return { error: "Missing X-HMDM-Username or X-HMDM-Password header (gateway mode requires both)." };
    }
  } else {
    username = (env.HMDM_USERNAME ?? "").trim();
    password = (env.HMDM_PASSWORD ?? "").trim();
    if (!username || !password) return { error: "Missing Headwind MDM credentials. Set HMDM_USERNAME and HMDM_PASSWORD." };
  }
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) {
    return { error: "Headwind MDM credentials are too long." };
  }
  return { username, password };
}

/**
 * Credentials for the current tool call. Request-scoped credentials (set by the
 * HTTP gateway path) win. In gateway mode there is NO fallback to the
 * environment: a call without scoped credentials is an error.
 */
export function resolveRequestCredentials(env: NodeJS.ProcessEnv = process.env): HeadwindCredentials | { error: string } {
  const scoped = credentialStore.getStore();
  if (scoped) return scoped;
  if (isGatewayAuth(env)) return { error: "Missing per-request credentials (gateway mode)." };
  return getCredentials(env);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function md5Uppercase(value: string): string {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}

/** Every string derived from the credentials that must never reach a result. */
function secretsFor(credentials: HeadwindCredentials, ...extra: string[]): string[] {
  const md5 = md5Uppercase(credentials.password);
  return [credentials.password, md5, md5.toLowerCase(), ...extra];
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/("(?:password|passwd|id_token|access_token|token|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDACTED]"')
    .replace(/\b(password|passwd|token|authorization)\s*=\s*\S+/gi, "$1=[REDACTED]");
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

/** Redact first, then truncate, so a secret split by the cut is never half-shown. */
export function redactAndTruncate(text: string, secrets: string[]): string {
  return redactSecrets(text, secrets).slice(0, MAX_MESSAGE_CHARS);
}

/** Redact every string in a (JSON) value: values, array items and object keys. */
export function redactData(data: unknown, secrets: string[]): unknown {
  if (typeof data === "string") return redactSecrets(data, secrets);
  if (Array.isArray(data)) return data.map((item) => redactData(item, secrets));
  if (typeof data === "object" && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [redactSecrets(key, secrets), redactData(value, secrets)]),
    );
  }
  return data;
}

// ---------------------------------------------------------------------------
// Token cache: per-credential, hashed keys, bounded
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Tokens are cached per (baseUrl, username, password) so one gateway user can
// never be served another user's token. Keys are HMAC-SHA256 digests under a
// random per-process key (never logged or exported), so no plaintext secret is
// ever a key and keys cannot be precomputed offline. Map insertion order gives an LRU: a hit re-inserts the
// entry and the oldest entry is evicted past MAX_TOKEN_CACHE.
const tokenCache = new Map<string, CachedToken>();

const CACHE_KEY_SECRET = randomBytes(32);

function cacheKey(baseUrl: string, credentials: HeadwindCredentials): string {
  return createHmac("sha256", CACHE_KEY_SECRET)
    .update(JSON.stringify([baseUrl, credentials.username, credentials.password]))
    .digest("hex");
}

function sweepExpired(now = Date.now()): void {
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
}

function cacheGet(key: string): string | undefined {
  const entry = tokenCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    tokenCache.delete(key);
    return undefined;
  }
  tokenCache.delete(key);
  tokenCache.set(key, entry);
  return entry.token;
}

function cacheSet(key: string, token: string): void {
  sweepExpired();
  tokenCache.delete(key);
  tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  while (tokenCache.size > MAX_TOKEN_CACHE) {
    const oldest = tokenCache.keys().next().value;
    if (oldest === undefined) break;
    tokenCache.delete(oldest);
  }
}

export function clearTokenCache(): void {
  tokenCache.clear();
}

export function tokenCacheSize(): number {
  return tokenCache.size;
}

/** Cache keys (HMAC-SHA256 hex digests only); exposed so tests can assert no plaintext secret is a key. */
export function tokenCacheKeys(): string[] {
  return [...tokenCache.keys()];
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

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

function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return "";
  return token;
}

async function fetchOnce(url: string, init: RequestInit, secrets: string[]): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HeadwindError("timeout", "Headwind MDM request timed out after 30 seconds.");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new HeadwindError("network", redactAndTruncate(`Request to Headwind MDM failed: ${message}`, secrets));
  }
}

/**
 * Read a response body with a hard cap of MAX_RESPONSE_CHARS bytes. Rejects early
 * on an oversized Content-Length and cancels the stream as soon as the cap is exceeded.
 */
async function readBodyLimited(response: Response): Promise<string> {
  const tooLarge = (): HeadwindError => new HeadwindError("http", "Headwind MDM response is too large.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_CHARS) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof HeadwindError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new HeadwindError("timeout", "Headwind MDM request timed out after 30 seconds.");
    }
    throw new HeadwindError("network", "Reading the Headwind MDM response failed.");
  }
  return text + decoder.decode();
}

// Single-flight login: concurrent logins for the same cache key share one promise.
const inflightLogins = new Map<string, Promise<string>>();

function singleFlightLogin(key: string, baseUrl: string, credentials: HeadwindCredentials): Promise<string> {
  const existing = inflightLogins.get(key);
  if (existing) return existing;
  const promise = login(baseUrl, credentials).finally(() => {
    inflightLogins.delete(key);
  });
  inflightLogins.set(key, promise);
  return promise;
}

/** POST the JWT login and cache the token. Never echoes the password or its MD5. */
async function login(baseUrl: string, credentials: HeadwindCredentials): Promise<string> {
  const passwordMd5 = md5Uppercase(credentials.password);
  const secrets = secretsFor(credentials);
  const response = await fetchOnce(
    `${baseUrl}${LOGIN_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ login: credentials.username, password: passwordMd5 }),
    },
    secrets,
  );
  if (response.status >= 300 && response.status < 400) {
    throw new HeadwindError("http", `Headwind MDM returned an unexpected redirect (status ${response.status}); redirects are not followed.`);
  }
  const body = safeJson(await readBodyLimited(response));
  const headerToken = response.ok ? extractBearerToken(response.headers.get("authorization")) : "";
  const bodyToken = response.ok && isRecord(body) && typeof body.id_token === "string" ? body.id_token : "";
  const token = headerToken || bodyToken;
  if (!response.ok || !token) {
    const upstream = isRecord(body) && typeof body.message === "string" ? `: ${body.message}` : "";
    throw new HeadwindError("auth", redactAndTruncate(`Headwind MDM authentication failed${upstream}`, [...secrets, token]));
  }
  cacheSet(cacheKey(baseUrl, credentials), token);
  return token;
}

/** Returns a (cached or fresh) bearer token for the credentials. */
export async function getAccessToken(credentials: HeadwindCredentials, baseUrl: string = getBaseUrl()): Promise<string> {
  const key = cacheKey(baseUrl, credentials);
  return cacheGet(key) ?? (await singleFlightLogin(key, baseUrl, credentials));
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function checkType(name: string, spec: ParamSpec, value: unknown): void {
  const fail = (expected: string): never => {
    throw new InputError(`Invalid input "${name}": expected ${expected}.`);
  };
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") fail("a string");
      if (spec.enum && !spec.enum.includes(value as string)) fail(`one of ${spec.enum.join(", ")}`);
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("an integer");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail("a number");
      break;
    case "boolean":
      if (typeof value !== "boolean") fail("a boolean");
      break;
    case "array":
      if (!Array.isArray(value)) fail("an array");
      if (spec.items) (value as unknown[]).forEach((item, index) => checkType(`${name}[${index}]`, spec.items as ParamSpec, item));
      break;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) fail("an object");
      if (spec.properties) checkProperties(name, spec.properties, value as Record<string, unknown>);
      break;
  }
  if ((spec.type === "integer" || spec.type === "number") && typeof value === "number") {
    if (spec.minimum !== undefined && value < spec.minimum) fail(`a value >= ${spec.minimum}`);
    if (spec.maximum !== undefined && value > spec.maximum) fail(`a value <= ${spec.maximum}`);
  }
}

function checkProperties(prefix: string, properties: Record<string, ParamSpec>, value: Record<string, unknown>): void {
  for (const [key, spec] of Object.entries(properties)) {
    const nested = Object.hasOwn(value, key) ? value[key] : undefined;
    if (nested === undefined || nested === null) {
      if (!spec.optional) throw new InputError(`Missing required input "${prefix}.${key}".`);
      continue;
    }
    checkType(`${prefix}.${key}`, spec, nested);
  }
}

/** Deep copy that drops prototype-polluting keys at every depth. */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_NESTING_DEPTH) throw new InputError("Invalid input: nesting is too deep.");
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSAFE_KEYS.has(key))
        .map(([key, nested]) => [key, sanitizeValue(nested, depth + 1)]),
    );
  }
  return value;
}

/**
 * Keep ONLY declared arguments: required ones must be present, types are
 * checked, undeclared arguments (including `__proto__` / `constructor`) are
 * dropped and never forwarded.
 */
export function validateArgs(endpoint: EndpointSpec, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(endpoint.params)) {
    const value = Object.hasOwn(args, name) ? args[name] : undefined;
    if (value === undefined || value === null) {
      if (!spec.optional) throw new InputError(`Missing required input "${name}".`);
      continue;
    }
    checkType(name, spec, value);
    out[name] = sanitizeValue(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function pathParamNames(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

/**
 * Validate and encode one value for use as a single URL path segment. Rejects
 * empty values, "." / "..", separators ("/" and "\\") and control characters,
 * then applies encodeURIComponent.
 */
export function encodePathValue(name: string, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new InputError(`Invalid input "${name}": expected a string or integer.`);
  }
  const text = String(value);
  // eslint-disable-next-line no-control-regex
  if (text === "" || text === "." || text === ".." || /[/\\\u0000-\u001f\u007f]/.test(text)) {
    throw new InputError(`Invalid input "${name}": not allowed in a URL path segment.`);
  }
  return encodeURIComponent(text);
}

/** Substitute EVERY placeholder in the raw template (single pass) and verify none is left. */
export function substitutePath(template: string, args: Record<string, unknown>): string {
  const path = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.hasOwn(args, name)) throw new InputError(`Missing required input "${name}".`);
    return encodePathValue(name, args[name]);
  });
  if (/[{}]/.test(path)) throw new InputError("Invalid path template.");
  return path;
}

/** Validate the arguments and build the upstream request. Only declared arguments are used. */
export function buildRequest(endpoint: EndpointSpec, rawArgs: Record<string, unknown>): BuiltRequest {
  const args = validateArgs(endpoint, rawArgs);
  const pathNames = new Set(pathParamNames(endpoint.path));
  const path = substitutePath(endpoint.path, args);
  const request: BuiltRequest = { method: endpoint.method, path };
  const rest = Object.entries(args).filter(([name]) => !pathNames.has(name) && name !== endpoint.bodyParam);
  const hasBody = endpoint.method === "POST" || endpoint.method === "PUT";
  if (endpoint.bodyParam && Object.hasOwn(args, endpoint.bodyParam)) {
    request.body = args[endpoint.bodyParam];
    request.bodyText = endpoint.bodyText === true;
    if (rest.length > 0) request.query = Object.fromEntries(rest);
  } else if (hasBody) {
    if (rest.length > 0) request.body = Object.fromEntries(rest);
  } else if (rest.length > 0) {
    request.query = Object.fromEntries(rest);
  }
  return request;
}

/** Everything except the public endpoints needs the bearer token. */
export function requiresAuth(path: string): boolean {
  return path.startsWith("/") && !path.startsWith(PUBLIC_PREFIX);
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const url = new URL(`${baseUrl}${path}`);
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`)) {
    throw new InputError("Invalid request path.");
  }
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
      else search.set(key, String(value));
    }
    url.search = search.toString();
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function failure(kind: HeadwindClientError["kind"], message: string): HeadwindClientResult {
  return { ok: false, error: { kind, message } };
}

export async function executeHeadwindRequest(
  input: BuiltRequest & { credentials: HeadwindCredentials; baseUrl?: string },
): Promise<HeadwindClientResult> {
  const { credentials } = input;
  let baseUrl: string;
  let url: string;
  try {
    baseUrl = input.baseUrl ?? getBaseUrl();
    url = buildUrl(baseUrl, input.path, input.query);
  } catch (error) {
    return failure("config", error instanceof Error ? error.message : String(error));
  }
  const secrets = secretsFor(credentials);
  const needsAuth = requiresAuth(input.path);
  const key = cacheKey(baseUrl, credentials);

  const send = (token: string): Promise<Response> => {
    const hasBody = input.body !== undefined && input.method !== "GET" && input.method !== "DELETE";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (hasBody) headers["Content-Type"] = input.bodyText ? "text/plain; charset=utf-8" : "application/json";
    return fetchOnce(
      url,
      { method: input.method, headers, body: hasBody ? (input.bodyText ? String(input.body) : JSON.stringify(input.body)) : undefined },
      [...secrets, token],
    );
  };

  let response: Response;
  let token = "";
  try {
    if (needsAuth) token = await getAccessToken(credentials, baseUrl);
    response = await send(token);
    if (response.status === 401 && needsAuth) {
      // Exactly ONE re-authentication and ONE retry; no recursion.
      tokenCache.delete(key);
      token = await singleFlightLogin(key, baseUrl, credentials);
      response = await send(token);
      if (response.status === 401) tokenCache.delete(key);
    }
  } catch (error) {
    if (error instanceof HeadwindError) return failure(error.kind, error.message);
    throw error;
  }
  secrets.push(token);

  if (response.status === 401) {
    return failure("auth", "Headwind MDM authentication failed (401) after re-authenticating.");
  }
  if (response.status >= 300 && response.status < 400) {
    return failure("http", `Headwind MDM returned an unexpected redirect (status ${response.status}); redirects are not followed.`);
  }
  let text: string;
  try {
    text = await readBodyLimited(response);
  } catch (error) {
    if (error instanceof HeadwindError) return failure(error.kind, error.message);
    throw error;
  }
  const body = safeJson(text);
  if (response.status >= 300) {
    const upstream = isRecord(body) && typeof body.message === "string" ? `: ${body.message}` : "";
    return failure(
      response.status === 403 ? "auth" : "http",
      redactAndTruncate(`Headwind MDM request failed with HTTP status ${response.status}${upstream}`, secrets),
    );
  }
  if (isRecord(body) && body.status === "ERROR") {
    const message = typeof body.message === "string" ? body.message : "Headwind MDM operation returned an error.";
    return failure("upsert", redactAndTruncate(message, secrets));
  }
  if (!isRecord(body) || body.status !== "OK") {
    return failure("http", "Headwind MDM response was missing a valid status envelope.");
  }
  return { ok: true, data: redactData(body.data ?? null, secrets) };
}
