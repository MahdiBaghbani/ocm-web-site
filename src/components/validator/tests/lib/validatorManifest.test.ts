import { describe, expect, test } from "bun:test";

import { parseValidatorManifest, type ValidatorManifest } from "@/components/validator/lib/validatorManifest";

function optInStart(active?: unknown): Record<string, unknown> {
  const start: Record<string, unknown> = {
    optInStats: { type: "boolean", default: false },
    optInPermanent: { type: "boolean", default: false },
  };
  if (active !== undefined) {
    start.optInActive = active;
  }
  return start;
}

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "federation_tester_manifest.v1",
    apiVersion: "v1",
    servicePrefix: "/validator",
    extraIgnored: true,
    optIn: {
      default: "off",
      start: optInStart(),
      scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
    },
    retention: {
      tiers: ["ephemeral", "permanent"],
      defaultTier: "ephemeral",
      clock: "utc",
      patchPath: "/retention",
      lockPath: "/lock",
    },
    report: { htmlPath: "/report/{id}", apiPath: "/api/report/{id}" },
    statistics: {
      schema: "federation_tester_statistics.v1",
      timeframesDays: [7, 14, 30],
      defaultDays: 14,
      kAnonymityUniqueHosts: 5,
      unknownPlatformExempt: false,
    },
    routes: [{ method: "GET", fullPath: "/api/manifest" }],
    reverseInvite: { available: true },
    platform: { available: false },
    tlsSummary: { available: true },
    sessionKind: { supported: ["passive", "active"], scanDefault: "passive" },
    nextInstruction: { created: "wait_probe", invite_minted: "paste_s1" },
    ...overrides,
  };
}

describe("parseValidatorManifest", () => {
  test("accepts a complete payload and ignores extra keys", () => {
    const parsed = parseValidatorManifest(validManifest());
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    const expected: ValidatorManifest = {
      schema: "federation_tester_manifest.v1",
      apiVersion: "v1",
      servicePrefix: "/validator",
      optIn: {
        default: "off",
        start: {
          optInStats: { type: "boolean", default: false },
          optInPermanent: { type: "boolean", default: false },
        },
        scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
      },
      retention: {
        tiers: ["ephemeral", "permanent"],
        defaultTier: "ephemeral",
        clock: "utc",
        patchPath: "/retention",
        lockPath: "/lock",
      },
      report: { htmlPath: "/report/{id}", apiPath: "/api/report/{id}" },
      statistics: {
        schema: "federation_tester_statistics.v1",
        timeframesDays: [7, 14, 30],
        defaultDays: 14,
        kAnonymityUniqueHosts: 5,
        unknownPlatformExempt: false,
      },
      routes: [{ method: "GET", fullPath: "/api/manifest" }],
      reverseInvite: { available: true },
      platform: { available: false },
      tlsSummary: { available: true },
      sessionKind: { supported: ["passive", "active"], scanDefault: "passive" },
      nextInstruction: { created: "wait_probe", invite_minted: "paste_s1" },
    };
    expect(parsed).toEqual(expected);
    expect(parsed.optIn.start.optInActive).toBeUndefined();
  });

  test("keeps optIn.start.optInActive when present as a field or null", () => {
    const withField = parseValidatorManifest(validManifest({
      optIn: {
        default: "off",
        start: optInStart({ type: "boolean", default: true }),
        scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
      },
    }));
    expect(withField?.optIn.start.optInActive).toEqual({ type: "boolean", default: true });

    const withNull = parseValidatorManifest(validManifest({
      optIn: {
        default: "off",
        start: optInStart(null),
        scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
      },
    }));
    expect(withNull?.optIn.start.optInActive).toBeNull();
  });

  test("rejects missing required top-level fields", () => {
    expect(parseValidatorManifest(null)).toBeNull();
    expect(parseValidatorManifest([])).toBeNull();
    expect(parseValidatorManifest("manifest")).toBeNull();
    for (const key of [
      "schema",
      "apiVersion",
      "servicePrefix",
      "optIn",
      "retention",
      "report",
      "statistics",
      "routes",
      "reverseInvite",
      "platform",
      "tlsSummary",
      "sessionKind",
      "nextInstruction",
    ]) {
      const body = validManifest();
      delete body[key];
      expect(parseValidatorManifest(body)).toBeNull();
    }
  });

  test("rejects malformed nested fields", () => {
    expect(parseValidatorManifest(validManifest({
      routes: [{ method: "GET" }],
    }))).toBeNull();
    expect(parseValidatorManifest(validManifest({
      statistics: {
        schema: "federation_tester_statistics.v1",
        timeframesDays: [7, "14", 30],
        defaultDays: 14,
        kAnonymityUniqueHosts: 5,
        unknownPlatformExempt: true,
      },
    }))).toBeNull();
    expect(parseValidatorManifest(validManifest({
      nextInstruction: { created: 1 },
    }))).toBeNull();
    expect(parseValidatorManifest(validManifest({
      optIn: {
        default: "off",
        start: optInStart({ type: "boolean" }),
        scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
      },
    }))).toBeNull();
    expect(parseValidatorManifest(validManifest({
      retention: {
        tiers: ["ephemeral", 1],
        defaultTier: "ephemeral",
        clock: "utc",
        patchPath: "/retention",
        lockPath: "/lock",
      },
    }))).toBeNull();
    expect(parseValidatorManifest(validManifest({
      reverseInvite: { available: "yes" },
    }))).toBeNull();
  });

  test("rejects malformed optIn.start.optInActive when the key is present", () => {
    expect(parseValidatorManifest(validManifest({
      optIn: {
        default: "off",
        start: optInStart({ default: true }),
        scan: { statsQuery: "stats", permanentQuery: "permanent", optInValue: "1" },
      },
    }))).toBeNull();
  });
});
