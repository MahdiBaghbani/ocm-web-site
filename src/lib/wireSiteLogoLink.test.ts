import { afterEach, describe, expect, test } from "bun:test";

import { resetSharedRuntimeConfigForTests } from "./siteRuntimeConfig";
import {
  applySiteLogoLink,
  SITE_LOGO_LINK_ID,
  type SiteLogoAnchor,
  wireSiteLogoLink,
} from "./wireSiteLogoLink";

afterEach(() => {
  resetSharedRuntimeConfigForTests();
});

function fakeAnchor(initialHref: string): SiteLogoAnchor {
  const attrs = new Map<string, string>([["href", initialHref]]);
  return {
    get href(): string {
      return attrs.get("href") ?? "";
    },
    set href(value: string) {
      attrs.set("href", value);
    },
    get target(): string {
      return attrs.get("target") ?? "";
    },
    set target(value: string) {
      attrs.set("target", value);
    },
    get rel(): string {
      return attrs.get("rel") ?? "";
    },
    set rel(value: string) {
      attrs.set("rel", value);
    },
    removeAttribute(name: string): void {
      attrs.delete(name);
    },
  };
}

describe("wireSiteLogoLink", () => {
  test("does nothing when document is unavailable", () => {
    expect(() => wireSiteLogoLink("/")).not.toThrow();
    expect(SITE_LOGO_LINK_ID).toBe("site-logo-link");
  });
});

describe("applySiteLogoLink", () => {
  test("applies an external logo href after config loads", async () => {
    const fetchLike = async () =>
      new Response(JSON.stringify({ logo_href: "https://logo.example" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const { loadSharedRuntimeConfig } = await import("./siteRuntimeConfig");
    await loadSharedRuntimeConfig(fetchLike);

    const anchor = fakeAnchor("/");
    await applySiteLogoLink(anchor, "/");
    expect(anchor.href).toBe("https://logo.example");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
  });

  test("uses community_url when logo_href is empty", async () => {
    const fetchLike = async () =>
      new Response(JSON.stringify({ community_url: "https://community.example" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const { loadSharedRuntimeConfig } = await import("./siteRuntimeConfig");
    await loadSharedRuntimeConfig(fetchLike);

    const anchor = fakeAnchor("/");
    await applySiteLogoLink(anchor, "/");
    expect(anchor.href).toBe("https://community.example");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
  });

  test("keeps the base href when config has no logo target", async () => {
    const fetchLike = async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const { loadSharedRuntimeConfig } = await import("./siteRuntimeConfig");
    await loadSharedRuntimeConfig(fetchLike);

    const removed: string[] = [];
    const anchor = fakeAnchor("/");
    const originalRemove = anchor.removeAttribute.bind(anchor);
    anchor.removeAttribute = (name: string) => {
      removed.push(name);
      originalRemove(name);
    };

    await applySiteLogoLink(anchor, "/site/");
    expect(anchor.href).toBe("/site/");
    expect(removed).toEqual(["target", "rel"]);
  });
});
