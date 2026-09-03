/**
 * Typed federation_tester_manifest.v1 payload. Extra keys are ignored.
 */

import { isRecord } from "./validatorShared";

export interface ValidatorOptInField {
  type: string;
  default: boolean;
}

export interface ValidatorManifestOptInStart {
  optInStats: ValidatorOptInField;
  optInPermanent: ValidatorOptInField;
  optInActive?: ValidatorOptInField | null;
}

export interface ValidatorManifestOptInScan {
  statsQuery: string;
  permanentQuery: string;
  optInValue: string;
}

export interface ValidatorManifestOptIn {
  default: string;
  start: ValidatorManifestOptInStart;
  scan: ValidatorManifestOptInScan;
}

export interface ValidatorManifestRetention {
  tiers: string[];
  defaultTier: string;
  clock: string;
  patchPath: string;
  lockPath: string;
}

export interface ValidatorManifestReport {
  htmlPath: string;
  apiPath: string;
}

export interface ValidatorManifestStatistics {
  schema: string;
  timeframesDays: number[];
  defaultDays: number;
  kAnonymityUniqueHosts: number;
  unknownPlatformExempt: boolean;
}

export interface ValidatorManifestRoute {
  method: string;
  fullPath: string;
}

export interface ValidatorAvailability {
  available: boolean;
}

export interface ValidatorSessionKind {
  supported: string[];
  scanDefault: string;
}

export interface ValidatorManifest {
  schema: string;
  apiVersion: string;
  servicePrefix: string;
  optIn: ValidatorManifestOptIn;
  retention: ValidatorManifestRetention;
  report: ValidatorManifestReport;
  statistics: ValidatorManifestStatistics;
  routes: ValidatorManifestRoute[];
  reverseInvite: ValidatorAvailability;
  platform: ValidatorAvailability;
  tlsSummary: ValidatorAvailability;
  sessionKind: ValidatorSessionKind;
  nextInstruction: Record<string, string>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    items.push(item);
  }
  return items;
}

function readNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: number[] = [];
  for (const item of value) {
    const number = readFiniteNumber(item);
    if (number === null) {
      return null;
    }
    items.push(number);
  }
  return items;
}

function readAvailability(value: unknown): ValidatorAvailability | null {
  return isRecord(value) && typeof value.available === "boolean"
    ? { available: value.available }
    : null;
}

function readOptInField(value: unknown): ValidatorOptInField | null {
  if (!isRecord(value) || typeof value.default !== "boolean") {
    return null;
  }
  const type = readString(value.type);
  return type === null ? null : { type, default: value.default };
}

function readStringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const mapped: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      return null;
    }
    mapped[key] = item;
  }
  return mapped;
}

function readRoutes(value: unknown): ValidatorManifestRoute[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const routes: ValidatorManifestRoute[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const method = readString(item.method);
    const fullPath = readString(item.fullPath);
    if (method === null || fullPath === null) {
      return null;
    }
    routes.push({ method, fullPath });
  }
  return routes;
}

function readOptInStart(value: unknown): ValidatorManifestOptInStart | null {
  if (!isRecord(value)) {
    return null;
  }
  const optInStats = readOptInField(value.optInStats);
  const optInPermanent = readOptInField(value.optInPermanent);
  if (optInStats === null || optInPermanent === null) {
    return null;
  }
  const start: ValidatorManifestOptInStart = { optInStats, optInPermanent };
  if (!Object.hasOwn(value, "optInActive")) {
    return start;
  }
  if (value.optInActive === null) {
    start.optInActive = null;
    return start;
  }
  const optInActive = readOptInField(value.optInActive);
  if (optInActive === null) {
    return null;
  }
  start.optInActive = optInActive;
  return start;
}

function readOptIn(value: unknown): ValidatorManifestOptIn | null {
  if (!isRecord(value) || !isRecord(value.scan)) {
    return null;
  }
  const defaultValue = readString(value.default);
  const start = readOptInStart(value.start);
  const statsQuery = readString(value.scan.statsQuery);
  const permanentQuery = readString(value.scan.permanentQuery);
  const optInValue = readString(value.scan.optInValue);
  if (
    defaultValue === null ||
    start === null ||
    statsQuery === null ||
    permanentQuery === null ||
    optInValue === null
  ) {
    return null;
  }
  return {
    default: defaultValue,
    start,
    scan: { statsQuery, permanentQuery, optInValue },
  };
}

function readRetention(value: unknown): ValidatorManifestRetention | null {
  if (!isRecord(value)) {
    return null;
  }
  const tiers = readStringArray(value.tiers);
  const defaultTier = readString(value.defaultTier);
  const clock = readString(value.clock);
  const patchPath = readString(value.patchPath);
  const lockPath = readString(value.lockPath);
  return tiers === null || defaultTier === null || clock === null ||
    patchPath === null || lockPath === null
    ? null
    : { tiers, defaultTier, clock, patchPath, lockPath };
}

function readReport(value: unknown): ValidatorManifestReport | null {
  if (!isRecord(value)) {
    return null;
  }
  const htmlPath = readString(value.htmlPath);
  const apiPath = readString(value.apiPath);
  return htmlPath === null || apiPath === null ? null : { htmlPath, apiPath };
}

function readStatistics(value: unknown): ValidatorManifestStatistics | null {
  if (!isRecord(value) || typeof value.unknownPlatformExempt !== "boolean") {
    return null;
  }
  const schema = readString(value.schema);
  const timeframesDays = readNumberArray(value.timeframesDays);
  const defaultDays = readFiniteNumber(value.defaultDays);
  const kAnonymityUniqueHosts = readFiniteNumber(value.kAnonymityUniqueHosts);
  return schema === null || timeframesDays === null || defaultDays === null ||
    kAnonymityUniqueHosts === null
    ? null
    : {
      schema,
      timeframesDays,
      defaultDays,
      kAnonymityUniqueHosts,
      unknownPlatformExempt: value.unknownPlatformExempt,
    };
}

function readSessionKind(value: unknown): ValidatorSessionKind | null {
  if (!isRecord(value)) {
    return null;
  }
  const supported = readStringArray(value.supported);
  const scanDefault = readString(value.scanDefault);
  return supported === null || scanDefault === null ? null : { supported, scanDefault };
}

/** Narrow an /api/manifest JSON body. Returns null when required fields fail. */
export function parseValidatorManifest(body: unknown): ValidatorManifest | null {
  if (!isRecord(body)) {
    return null;
  }
  const schema = readString(body.schema);
  const apiVersion = readString(body.apiVersion);
  const servicePrefix = readString(body.servicePrefix);
  const optIn = readOptIn(body.optIn);
  const retention = readRetention(body.retention);
  const report = readReport(body.report);
  const statistics = readStatistics(body.statistics);
  const routes = readRoutes(body.routes);
  const reverseInvite = readAvailability(body.reverseInvite);
  const platform = readAvailability(body.platform);
  const tlsSummary = readAvailability(body.tlsSummary);
  const sessionKind = readSessionKind(body.sessionKind);
  const nextInstruction = readStringMap(body.nextInstruction);
  if (
    schema === null ||
    apiVersion === null ||
    servicePrefix === null ||
    optIn === null ||
    retention === null ||
    report === null ||
    statistics === null ||
    routes === null ||
    reverseInvite === null ||
    platform === null ||
    tlsSummary === null ||
    sessionKind === null ||
    nextInstruction === null
  ) {
    return null;
  }
  return {
    schema,
    apiVersion,
    servicePrefix,
    optIn,
    retention,
    report,
    statistics,
    routes,
    reverseInvite,
    platform,
    tlsSummary,
    sessionKind,
    nextInstruction,
  };
}
