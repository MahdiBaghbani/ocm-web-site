import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_VALIDATOR_CONFIG } from "../components/validator/lib/validatorConfig";
import {
  loadSharedRuntimeConfig,
  resetSharedRuntimeConfigForTests,
  resolveSiteLogoHref,
  siteLogoLinkAttrs,
} from "./siteRuntimeConfig";

afterEach(() => {
  resetSharedRuntimeConfigForTests();
});

function stubGlobalFetch(body: unknown): () => void {
  const previous = globalThis.fetch;
  const stub = Object.assign(
    async (_input: string | URL | Request) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    { preconnect: previous.preconnect.bind(previous) },
  );
  globalThis.fetch = stub;
  return () => {
    globalThis.fetch = previous;
  };
}

describe("resolveSiteLogoHref", () => {
  test("prefers logoHref over communityUrl", () => {
    expect(
      resolveSiteLogoHref({
        ...DEFAULT_VALIDATOR_CONFIG,
        logoHref: "https://logo.example",
        communityUrl: "https://community.example",
      }),
    ).toBe("https://logo.example");
  });

  test("falls through to communityUrl when logoHref is empty or whitespace", () => {
    expect(
      resolveSiteLogoHref({
        ...DEFAULT_VALIDATOR_CONFIG,
        logoHref: "",
        communityUrl: "https://community.example",
      }),
    ).toBe("https://community.example");
    expect(
      resolveSiteLogoHref({
        ...DEFAULT_VALIDATOR_CONFIG,
        logoHref: "   ",
        communityUrl: "https://community.example",
      }),
    ).toBe("https://community.example");
  });

  test("returns empty when both are unset", () => {
    expect(resolveSiteLogoHref({ ...DEFAULT_VALIDATOR_CONFIG })).toBe("");
  });
});

describe("siteLogoLinkAttrs", () => {
  test("uses base fallback when href is empty", () => {
    expect(siteLogoLinkAttrs("", "/site/")).toEqual({ href: "/site/" });
    expect(siteLogoLinkAttrs("", "/")).toEqual({ href: "/" });
    expect(siteLogoLinkAttrs("", "")).toEqual({ href: "/" });
  });

  test("http and https hrefs open in a new tab", () => {
    const expected = {
      target: "_blank",
      rel: "noopener noreferrer",
    } as const;
    expect(siteLogoLinkAttrs("https://example.org", "/")).toEqual({
      href: "https://example.org",
      ...expected,
    });
    expect(siteLogoLinkAttrs("http://example.org", "/")).toEqual({
      href: "http://example.org",
      ...expected,
    });
  });

  test("internal href is prefixed with base", () => {
    expect(siteLogoLinkAttrs("observatory/", "/site/")).toEqual({
      href: "/site/observatory/",
    });
    expect(siteLogoLinkAttrs("/observatory/", "/site")).toEqual({
      href: "/site/observatory/",
    });
  });
});

describe("loadSharedRuntimeConfig", () => {
  test("reuses one in-flight fetch for multiple callers", async () => {
    let calls = 0;
    const fetchLike = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ community_url: "https://shared.example" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const [first, second] = await Promise.all([
      loadSharedRuntimeConfig(fetchLike),
      loadSharedRuntimeConfig(fetchLike),
    ]);

    expect(calls).toBe(1);
    expect(first.communityUrl).toBe("https://shared.example");
    expect(second.communityUrl).toBe("https://shared.example");
  });

  test("reads the current global fetch after the cache is reset", async () => {
    const restoreFirst = stubGlobalFetch({
      community_url: "https://first.example",
    });
    try {
      await expect(loadSharedRuntimeConfig()).resolves.toMatchObject({
        communityUrl: "https://first.example",
      });
    } finally {
      restoreFirst();
    }

    resetSharedRuntimeConfigForTests();

    const restoreSecond = stubGlobalFetch({
      community_url: "https://second.example",
    });
    try {
      await expect(loadSharedRuntimeConfig()).resolves.toMatchObject({
        communityUrl: "https://second.example",
      });
    } finally {
      restoreSecond();
    }
  });
});
