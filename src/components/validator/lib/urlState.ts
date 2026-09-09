/**
 * Shareable validator URL state. Only normalized host and session id.
 * Parse and serialize are deterministic and have no history side effects.
 */

export const URL_HOST_PARAM = "host";
export const URL_ID_PARAM = "id";

const FALLBACK_ORIGIN = "https://validator.invalid";
const SESSION_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const IPV4_PATTERN = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV6_HEX_GROUP = /^[0-9a-f]{1,4}$/;

export interface ValidatorUrlState {
  host: string;
  id: string;
}

export type UrlStateReason =
  | "invalid_url"
  | "missing_host"
  | "missing_id"
  | "invalid_host"
  | "invalid_id";

export type UrlStateParseResult =
  | { ok: true; state: ValidatorUrlState }
  | { ok: false; reason: UrlStateReason };

export type UrlStateSerializeResult =
  | { ok: true; href: string }
  | { ok: false; reason: UrlStateReason };

export type UrlStateLocation = "query" | "hash";

export interface SerializeUrlStateOptions {
  base?: string | URL;
  location?: UrlStateLocation;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeSessionId(raw: string): string | null {
  const id = raw.trim();
  if (!SESSION_ID_PATTERN.test(id)) {
    return null;
  }
  return id;
}

function portFromSuffix(suffix: string): number | null {
  if (suffix === "") {
    return null;
  }
  if (!/^\d{1,5}$/.test(suffix)) {
    return null;
  }
  const port = Number(suffix);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function splitHostPort(value: string): { name: string; port: string | null } | null {
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close <= 1) {
      return null;
    }
    const name = value.slice(0, close + 1);
    const rest = value.slice(close + 1);
    if (rest === "") {
      return { name, port: null };
    }
    if (!rest.startsWith(":")) {
      return null;
    }
    return { name, port: rest.slice(1) };
  }

  const colon = value.lastIndexOf(":");
  if (colon === -1) {
    return { name: value, port: null };
  }
  if (value.includes(":") && value.indexOf(":") !== colon) {
    return null;
  }
  return { name: value.slice(0, colon), port: value.slice(colon + 1) };
}

function parseIpv6Side(side: string): string[] {
  return side === "" ? [] : side.split(":");
}

function isValidIpv6Inner(inner: string): boolean {
  if (inner.length === 0 || inner.includes(":::")) {
    return false;
  }
  const halves = inner.split("::");
  if (halves.length > 2) {
    return false;
  }
  const compressed = halves.length === 2;
  const groups = compressed
    ? [...parseIpv6Side(halves[0] ?? ""), ...parseIpv6Side(halves[1] ?? "")]
    : parseIpv6Side(halves[0] ?? "");
  let hextets = groups.length;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes(".")) {
    if (!IPV4_PATTERN.test(last)) {
      return false;
    }
    groups.pop();
    hextets = groups.length + 2;
  }
  if (groups.some((group) => !IPV6_HEX_GROUP.test(group))) {
    return false;
  }
  return compressed ? hextets < 8 : hextets === 8;
}

function isValidIpv6Literal(bracketed: string): boolean {
  if (!bracketed.startsWith("[") || !bracketed.endsWith("]")) {
    return false;
  }
  return isValidIpv6Inner(bracketed.slice(1, -1).toLowerCase());
}

function isValidHostname(name: string): boolean {
  if (name.length === 0 || name.length > 253) {
    return false;
  }
  if (IPV4_PATTERN.test(name)) {
    return true;
  }
  const labels = name.split(".");
  if (labels.some((label) => label.length === 0 || !HOST_LABEL_PATTERN.test(label))) {
    return false;
  }
  return true;
}

export function isValidHost(host: string): boolean {
  const parts = splitHostPort(host);
  if (parts === null) {
    return false;
  }
  if (parts.port !== null && portFromSuffix(parts.port) === null) {
    return false;
  }
  if (parts.name.startsWith("[")) {
    return isValidIpv6Literal(parts.name);
  }
  return isValidHostname(parts.name);
}

function hostFromAbsoluteUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return null;
  }
  const host = parsed.host.trim().toLowerCase();
  if (!isValidHost(host)) {
    return null;
  }
  return host;
}

function hostFromBareInput(raw: string): string | null {
  if (raw.includes("@") || raw.startsWith("//")) {
    return null;
  }
  // Require "://" so DNS host:port (peer.example:8443) is not a scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return null;
  }

  let candidate = raw;
  const cut = candidate.search(/[/?#]/);
  if (cut !== -1) {
    candidate = candidate.slice(0, cut);
  }
  candidate = candidate.replace(/\.$/, "").trim().toLowerCase();
  if (!isValidHost(candidate)) {
    return null;
  }
  return candidate;
}

/** Trim, lowercase, strip http(s) scheme and path, then validate as a host. */
export function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (isAbsoluteHttpUrl(trimmed)) {
    return hostFromAbsoluteUrl(trimmed);
  }
  return hostFromBareInput(trimmed);
}

function looksLikeRelativePageUrl(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("?") ||
    value.startsWith("#") ||
    value.includes("?") ||
    value.includes("#")
  );
}

function toUrl(input: string | URL): URL | null {
  if (input instanceof URL) {
    return new URL(input.href);
  }
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  if (isAbsoluteHttpUrl(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      return new URL(trimmed);
    } catch {
      return null;
    }
  }
  if (looksLikeRelativePageUrl(trimmed)) {
    try {
      return new URL(trimmed, `${FALLBACK_ORIGIN}/`);
    } catch {
      return null;
    }
  }
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf("?");
  const query = queryIndex === -1 ? raw : raw.slice(queryIndex + 1);
  return new URLSearchParams(query);
}

function readStateParams(params: URLSearchParams): UrlStateParseResult {
  const hasHost = params.has(URL_HOST_PARAM);
  const hasId = params.has(URL_ID_PARAM);
  if (!hasHost && !hasId) {
    return { ok: false, reason: "missing_host" };
  }

  const hostRaw = params.get(URL_HOST_PARAM);
  const idRaw = params.get(URL_ID_PARAM);
  if (hostRaw === null || hostRaw.trim() === "") {
    return { ok: false, reason: "missing_host" };
  }
  if (idRaw === null || idRaw.trim() === "") {
    return { ok: false, reason: "missing_id" };
  }

  const host = normalizeHost(hostRaw);
  if (host === null) {
    return { ok: false, reason: "invalid_host" };
  }
  const id = normalizeSessionId(idRaw);
  if (id === null) {
    return { ok: false, reason: "invalid_id" };
  }
  return { ok: true, state: { host, id } };
}

/** Read host and id from query params, or from the hash when query is empty. */
export function parseValidatorUrlState(input: string | URL): UrlStateParseResult {
  const url = toUrl(input);
  if (url === null) {
    return { ok: false, reason: "invalid_url" };
  }

  const queryHasState =
    url.searchParams.has(URL_HOST_PARAM) || url.searchParams.has(URL_ID_PARAM);
  const params = queryHasState ? url.searchParams : parseHashParams(url.hash);
  return readStateParams(params);
}

function resolveBaseUrl(base: string | URL | undefined): {
  url: URL;
  absolute: boolean;
} | null {
  try {
    if (base === undefined) {
      return { url: new URL(`${FALLBACK_ORIGIN}/`), absolute: false };
    }
    if (base instanceof URL) {
      return { url: new URL(base.href), absolute: true };
    }
    if (isAbsoluteHttpUrl(base)) {
      return { url: new URL(base), absolute: true };
    }
    return { url: new URL(base, `${FALLBACK_ORIGIN}/`), absolute: false };
  } catch {
    return null;
  }
}

function encodeStateParams(host: string, id: string): string {
  const params = new URLSearchParams();
  params.set(URL_HOST_PARAM, host);
  params.set(URL_ID_PARAM, id);
  return params.toString();
}

/** Write only host and id to query or hash. Other params are not preserved. */
export function serializeValidatorUrlState(
  state: ValidatorUrlState,
  options: SerializeUrlStateOptions = {},
): UrlStateSerializeResult {
  const host = normalizeHost(state.host);
  if (host === null) {
    return { ok: false, reason: "invalid_host" };
  }
  const id = normalizeSessionId(state.id);
  if (id === null) {
    return { ok: false, reason: "invalid_id" };
  }

  const encoded = encodeStateParams(host, id);
  const location = options.location ?? "query";
  const resolved = resolveBaseUrl(options.base);
  if (resolved === null) {
    return { ok: false, reason: "invalid_url" };
  }
  const { url, absolute } = resolved;
  url.search = "";
  url.hash = "";

  if (options.base === undefined) {
    return {
      ok: true,
      href: location === "hash" ? `#${encoded}` : `?${encoded}`,
    };
  }

  if (location === "hash") {
    url.hash = encoded;
  } else {
    url.search = encoded;
  }

  if (absolute) {
    return { ok: true, href: url.href };
  }

  const path = `${url.pathname}${url.search}${url.hash}`;
  return { ok: true, href: path };
}
