import { describe, expect, test } from "bun:test";

import {
  CONFIG_JSON_PATH,
  CONFIG_ORIGIN_KEY,
  DEFAULT_VALIDATOR_CONFIG,
  fetchConfigSource,
  loadValidatorConfig,
  parseValidatorConfig,
} from "./validatorConfig";

describe("validatorConfig defaults", () => {
  test("exposes poll, backoff, and timeout defaults", () => {
    expect(DEFAULT_VALIDATOR_CONFIG).toEqual({
      validatorApiOrigin: "",
      pollIntervalMs: 1000,
      activePollIntervalMs: 2000,
      backoffInitialMs: 1000,
      backoffMaxMs: 8000,
      requestTimeoutMs: 10_000,
    });
  });

  test("load without a source returns defaults", async () => {
    await expect(loadValidatorConfig()).resolves.toEqual({
      ...DEFAULT_VALIDATOR_CONFIG,
    });
  });
});

describe("parseValidatorConfig", () => {
  test("empty origin means same origin", () => {
    expect(
      parseValidatorConfig({ [CONFIG_ORIGIN_KEY]: "" }).validatorApiOrigin,
    ).toBe("");
    expect(
      parseValidatorConfig({ [CONFIG_ORIGIN_KEY]: "   " }).validatorApiOrigin,
    ).toBe("");
  });

  test("keeps an absolute http(s) origin and drops path", () => {
    expect(
      parseValidatorConfig({
        [CONFIG_ORIGIN_KEY]: "https://backend.ocm.example/validator/",
      }).validatorApiOrigin,
    ).toBe("https://backend.ocm.example");
    expect(
      parseValidatorConfig({
        [CONFIG_ORIGIN_KEY]: "http://127.0.0.1:9200",
      }).validatorApiOrigin,
    ).toBe("http://127.0.0.1:9200");
  });

  test("invalid origin overlays fall back to empty same-origin", () => {
    expect(
      parseValidatorConfig({ [CONFIG_ORIGIN_KEY]: "ftp://backend.example" })
        .validatorApiOrigin,
    ).toBe("");
    expect(
      parseValidatorConfig({ [CONFIG_ORIGIN_KEY]: "not-a-url" })
        .validatorApiOrigin,
    ).toBe("");
    expect(parseValidatorConfig(null)).toEqual({ ...DEFAULT_VALIDATOR_CONFIG });
  });

  test("optional numeric overlays replace defaults and lift a low cap", () => {
    expect(
      parseValidatorConfig({
        [CONFIG_ORIGIN_KEY]: "",
        poll_interval_ms: 1500,
        activePollIntervalMs: 2500,
        backoff_initial_ms: 2000,
        backoff_max_ms: 1000,
        request_timeout_ms: 5000,
      }),
    ).toEqual({
      validatorApiOrigin: "",
      pollIntervalMs: 1500,
      activePollIntervalMs: 2500,
      backoffInitialMs: 2000,
      backoffMaxMs: 2000,
      requestTimeoutMs: 5000,
    });
  });

  test("non-positive numbers keep defaults", () => {
    expect(
      parseValidatorConfig({
        poll_interval_ms: 0,
        backoffInitialMs: -1,
        request_timeout_ms: 1.5,
      }),
    ).toEqual({ ...DEFAULT_VALIDATOR_CONFIG });
  });
});

describe("loadValidatorConfig sources", () => {
  test("reads an injected record", async () => {
    const loaded = await loadValidatorConfig({
      read: () => ({
        [CONFIG_ORIGIN_KEY]: "https://api.example.com",
      }),
    });
    expect(loaded.validatorApiOrigin).toBe("https://api.example.com");
    expect(loaded.pollIntervalMs).toBe(DEFAULT_VALIDATOR_CONFIG.pollIntervalMs);
  });

  test("swallows source failures", async () => {
    await expect(
      loadValidatorConfig({
        read: () => {
          throw new Error("unavailable");
        },
      }),
    ).resolves.toEqual({ ...DEFAULT_VALIDATOR_CONFIG });
  });

  test("fetch source loads /config.json and ignores HTTP errors", async () => {
    const calls: string[] = [];
    const ok = fetchConfigSource(async (input) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ [CONFIG_ORIGIN_KEY]: "https://split.example" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    await expect(loadValidatorConfig(ok)).resolves.toMatchObject({
      validatorApiOrigin: "https://split.example",
    });
    expect(calls).toEqual([CONFIG_JSON_PATH]);

    const missing = fetchConfigSource(async () => new Response("missing", { status: 404 }));
    await expect(loadValidatorConfig(missing)).resolves.toEqual({
      ...DEFAULT_VALIDATOR_CONFIG,
    });
  });
});
