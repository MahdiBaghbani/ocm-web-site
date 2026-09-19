import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildConfigJsonRecord, writeConfigJson } from "./write-config-json";

const ENV_KEYS = [
  "SITE_COMMUNITY_URL",
  "SITE_LOGO_HREF",
  "VALIDATOR_CONTACT",
  "SITE_VALIDATOR_API_ORIGIN",
] as const;

const inherited: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  SITE_COMMUNITY_URL: process.env.SITE_COMMUNITY_URL,
  SITE_LOGO_HREF: process.env.SITE_LOGO_HREF,
  VALIDATOR_CONTACT: process.env.VALIDATOR_CONTACT,
  SITE_VALIDATOR_API_ORIGIN: process.env.SITE_VALIDATOR_API_ORIGIN,
};

function clearMappedEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = inherited[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("buildConfigJsonRecord", () => {
  test("returns null when every env var is empty", () => {
    clearMappedEnv();
    expect(buildConfigJsonRecord()).toBeNull();
  });

  test("treats whitespace-only env as empty", () => {
    for (const key of ENV_KEYS) {
      process.env[key] = "   ";
    }
    expect(buildConfigJsonRecord()).toBeNull();
  });

  test("maps non-empty env vars to snake_case keys", () => {
    clearMappedEnv();
    process.env.SITE_COMMUNITY_URL = "https://community.example";
    process.env.VALIDATOR_CONTACT = "ops@example.com";
    expect(buildConfigJsonRecord()).toEqual({
      community_url: "https://community.example",
      validator_contact: "ops@example.com",
    });
  });

  test("maps all four env vars when set", () => {
    process.env.SITE_COMMUNITY_URL = "https://community.example";
    process.env.SITE_LOGO_HREF = "https://logo.example";
    process.env.VALIDATOR_CONTACT = "ops@example.com";
    process.env.SITE_VALIDATOR_API_ORIGIN = "https://api.example";
    expect(buildConfigJsonRecord()).toEqual({
      community_url: "https://community.example",
      logo_href: "https://logo.example",
      validator_contact: "ops@example.com",
      validator_api_origin: "https://api.example",
    });
  });
});

describe("writeConfigJson", () => {
  test("writes dist/config.json when env is set", async () => {
    clearMappedEnv();
    process.env.SITE_LOGO_HREF = "https://logo.example";
    const dir = await mkdtemp(join(tmpdir(), "ocm-config-json-"));
    try {
      const written = await writeConfigJson(dir);
      expect(written).toBe(true);
      const body = await readFile(join(dir, "config.json"), "utf8");
      expect(JSON.parse(body)).toEqual({
        logo_href: "https://logo.example",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes nothing when env is empty", async () => {
    clearMappedEnv();
    const dir = await mkdtemp(join(tmpdir(), "ocm-config-json-"));
    try {
      const written = await writeConfigJson(dir);
      expect(written).toBe(false);
      await expect(access(join(dir, "config.json"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
