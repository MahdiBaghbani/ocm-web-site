/**
 * Runtime validator config. Empty API origin means same-origin /validator.
 */

export const CONFIG_JSON_PATH = "/config.json";
export const CONFIG_ORIGIN_KEY = "validator_api_origin";

export interface ValidatorRuntimeConfig {
  validatorApiOrigin: string;
  pollIntervalMs: number;
  activePollIntervalMs: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_VALIDATOR_CONFIG = {
  validatorApiOrigin: "",
  pollIntervalMs: 1000,
  activePollIntervalMs: 2000,
  backoffInitialMs: 1000,
  backoffMaxMs: 8000,
  requestTimeoutMs: 10_000,
} as const satisfies ValidatorRuntimeConfig;

export interface ValidatorConfigSource {
  read(): Promise<unknown> | unknown;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaults(): ValidatorRuntimeConfig {
  return {
    validatorApiOrigin: DEFAULT_VALIDATOR_CONFIG.validatorApiOrigin,
    pollIntervalMs: DEFAULT_VALIDATOR_CONFIG.pollIntervalMs,
    activePollIntervalMs: DEFAULT_VALIDATOR_CONFIG.activePollIntervalMs,
    backoffInitialMs: DEFAULT_VALIDATOR_CONFIG.backoffInitialMs,
    backoffMaxMs: DEFAULT_VALIDATOR_CONFIG.backoffMaxMs,
    requestTimeoutMs: DEFAULT_VALIDATOR_CONFIG.requestTimeoutMs,
  };
}

function normalizeApiOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "";
  }
  return parsed.origin;
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
  fallback: number,
): number {
  for (const key of keys) {
    if (key in record) {
      return positiveInt(record[key], fallback);
    }
  }
  return fallback;
}

/** Parse a config.json-shaped record. Unknown keys are ignored. */
export function parseValidatorConfig(raw: unknown): ValidatorRuntimeConfig {
  const config = cloneDefaults();
  if (!isRecord(raw)) {
    return config;
  }

  if (typeof raw[CONFIG_ORIGIN_KEY] === "string") {
    config.validatorApiOrigin = normalizeApiOrigin(raw[CONFIG_ORIGIN_KEY]);
  }

  config.pollIntervalMs = readOptionalNumber(
    raw,
    ["poll_interval_ms", "pollIntervalMs"],
    config.pollIntervalMs,
  );
  config.activePollIntervalMs = readOptionalNumber(
    raw,
    ["active_poll_interval_ms", "activePollIntervalMs"],
    config.activePollIntervalMs,
  );
  config.backoffInitialMs = readOptionalNumber(
    raw,
    ["backoff_initial_ms", "backoffInitialMs"],
    config.backoffInitialMs,
  );
  config.backoffMaxMs = readOptionalNumber(
    raw,
    ["backoff_max_ms", "backoffMaxMs"],
    config.backoffMaxMs,
  );
  config.requestTimeoutMs = readOptionalNumber(
    raw,
    ["request_timeout_ms", "requestTimeoutMs"],
    config.requestTimeoutMs,
  );

  if (config.backoffMaxMs < config.backoffInitialMs) {
    config.backoffMaxMs = config.backoffInitialMs;
  }

  return config;
}

export function fetchConfigSource(
  fetchLike: FetchLike,
  path: string = CONFIG_JSON_PATH,
): ValidatorConfigSource {
  return {
    async read() {
      const response = await fetchLike(path, { cache: "no-store" });
      if (!response.ok) {
        return {};
      }
      const body: unknown = await response.json();
      return body;
    },
  };
}

/** Load config from an injected source. Missing source returns defaults. */
export async function loadValidatorConfig(
  source?: ValidatorConfigSource,
): Promise<ValidatorRuntimeConfig> {
  if (source === undefined) {
    return cloneDefaults();
  }

  try {
    return parseValidatorConfig(await source.read());
  } catch {
    return cloneDefaults();
  }
}
