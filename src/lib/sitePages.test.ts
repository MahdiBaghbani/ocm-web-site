import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  PAGE_CATALOG,
  PAGE_ORDER,
  PROFILES,
  enabledPages,
  isPageMounted,
  landing,
  pagePath,
} from "./sitePages";

const SITE_ENV_KEYS = ["SITE_PROFILE", "SITE_PAGES"] as const;

const inheritedEnv: Record<(typeof SITE_ENV_KEYS)[number], string | undefined> =
  {
    SITE_PROFILE: process.env.SITE_PROFILE,
    SITE_PAGES: process.env.SITE_PAGES,
  };

function restoreInheritedEnv(): void {
  for (const key of SITE_ENV_KEYS) {
    const value = inheritedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearSiteEnv(): void {
  delete process.env.SITE_PROFILE;
  delete process.env.SITE_PAGES;
}

beforeEach(() => {
  clearSiteEnv();
});

afterEach(() => {
  mock.restore();
  restoreInheritedEnv();
});

describe("sitePages catalog", () => {
  test("four-key catalog and canonical order", () => {
    const expected = ["home", "observatory", "validator", "statistics"] as const;
    expect(PAGE_ORDER).toEqual(expected);
    expect(PAGE_CATALOG).toEqual(expected);
    expect([...PAGE_ORDER]).toEqual([...PAGE_CATALOG]);
  });
});

describe("sitePages profiles", () => {
  test("default preset resolves home, observatory", () => {
    expect(PROFILES.default).toEqual(["home", "observatory"]);
    expect(enabledPages()).toEqual(["home", "observatory"]);
    expect(isPageMounted("home")).toBe(true);
    expect(isPageMounted("observatory")).toBe(true);
    expect(isPageMounted("validator")).toBe(false);
    expect(isPageMounted("statistics")).toBe(false);
  });

  test("VPS preset resolves home, validator, statistics", () => {
    expect(PROFILES.VPS).toEqual(["home", "validator", "statistics"]);
    process.env.SITE_PROFILE = "VPS";
    expect(enabledPages()).toEqual(["home", "validator", "statistics"]);
    expect(isPageMounted("home")).toBe(true);
    expect(isPageMounted("validator")).toBe(true);
    expect(isPageMounted("statistics")).toBe(true);
    expect(isPageMounted("observatory")).toBe(false);
  });

  test("unknown SITE_PROFILE throws when SITE_PAGES is unset", () => {
    process.env.SITE_PROFILE = "not-a-profile";
    delete process.env.SITE_PAGES;
    expect(() => enabledPages()).toThrow(
      /Unknown SITE_PROFILE "not-a-profile"\. Known profiles: default, VPS\./,
    );
  });

  test("blank SITE_PROFILE defaults as unset when SITE_PAGES is unset", () => {
    process.env.SITE_PROFILE = " ";
    delete process.env.SITE_PAGES;
    expect(enabledPages()).toEqual(["home", "observatory"]);
  });
});

describe("sitePages SITE_PAGES", () => {
  test("SITE_PAGES CSV overrides SITE_PROFILE", () => {
    process.env.SITE_PROFILE = "VPS";
    process.env.SITE_PAGES = "observatory";
    expect(enabledPages()).toEqual(["observatory"]);
    expect(isPageMounted("observatory")).toBe(true);
    expect(isPageMounted("home")).toBe(false);
    expect(isPageMounted("validator")).toBe(false);
  });

  test("SITE_PAGES CSV overrides an invalid SITE_PROFILE", () => {
    process.env.SITE_PROFILE = "not-a-profile";
    process.env.SITE_PAGES = "home";
    expect(enabledPages()).toEqual(["home"]);
  });

  test("unknown page names are ignored and warned without failing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    process.env.SITE_PAGES = "home,not-a-page,validator,also-bad";
    expect(enabledPages()).toEqual(["home", "validator"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]).toEqual([
      'Unknown site page "not-a-page"; ignoring.',
    ]);
    expect(warn.mock.calls[1]).toEqual([
      'Unknown site page "also-bad"; ignoring.',
    ]);
  });

  test("known keys are deduped and canonically ordered", () => {
    process.env.SITE_PAGES =
      "statistics,home,home,validator,observatory,validator";
    expect(enabledPages()).toEqual([
      "home",
      "observatory",
      "validator",
      "statistics",
    ]);
  });

  test("empty resolved set throws", () => {
    process.env.SITE_PAGES = "";
    expect(() => enabledPages()).toThrow(
      /Resolved site page set is empty/,
    );

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    process.env.SITE_PAGES = "nope,also-nope";
    expect(() => enabledPages()).toThrow(
      /Resolved site page set is empty/,
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("sitePages landing", () => {
  test("landing is home when mounted, otherwise first mounted page", () => {
    expect(landing()).toBe("home");

    process.env.SITE_PAGES = "home,statistics";
    expect(landing()).toBe("home");

    process.env.SITE_PAGES = "statistics,validator";
    expect(landing()).toBe("validator");

    process.env.SITE_PAGES = "statistics";
    expect(landing()).toBe("statistics");
  });

  test("landing follows SITE_PROFILE and SITE_PAGES", () => {
    process.env.SITE_PROFILE = "VPS";
    expect(landing()).toBe("home");

    delete process.env.SITE_PROFILE;
    process.env.SITE_PAGES = "validator,statistics";
    expect(landing()).toBe("validator");
  });
});

describe("sitePages pagePath", () => {
  test("returns the relative path for every page key", () => {
    const expected = {
      home: "",
      observatory: "observatory/",
      validator: "validator/",
      statistics: "validator/statistics/",
    } as const satisfies Record<(typeof PAGE_ORDER)[number], string>;

    for (const key of PAGE_ORDER) {
      expect(pagePath(key)).toBe(expected[key]);
    }
  });
});
