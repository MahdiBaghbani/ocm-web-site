/**
 * Build-time page profile registry. SITE_PAGES (CSV) overrides SITE_PROFILE.
 * Unset SITE_PROFILE uses the `default` preset.
 */

/** Canonical page keys in mount and landing-priority order. */
export const PAGE_ORDER = [
  "home",
  "observatory",
  "validator",
  "statistics",
] as const;

export type PageKey = (typeof PAGE_ORDER)[number];

/** Closed catalog of known page keys, in canonical order. */
export const PAGE_CATALOG: readonly PageKey[] = PAGE_ORDER;

const PAGE_KEY_SET: ReadonlySet<string> = new Set(PAGE_ORDER);

/** Named presets. Each value is an ordered key set (canonicalized on resolve). */
export const PROFILES = {
  default: ["home", "observatory", "validator", "statistics"],
  "observatory-root": ["observatory"],
} as const satisfies Record<string, readonly PageKey[]>;

export type SiteProfile = keyof typeof PROFILES;

const EMPTY_SET_MESSAGE =
  "Resolved site page set is empty. Set SITE_PAGES or SITE_PROFILE to at least one known page.";

function isPageKey(value: string): value is PageKey {
  return PAGE_KEY_SET.has(value);
}

function isSiteProfile(value: string): value is SiteProfile {
  return Object.keys(PROFILES).includes(value);
}

function readTrimmedEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function keysFromProfile(raw: string | undefined): readonly PageKey[] {
  const name = raw === undefined || raw.trim() === "" ? "default" : raw.trim();
  if (!isSiteProfile(name)) {
    throw new Error(
      `Unknown SITE_PROFILE "${name}". Known profiles: ${Object.keys(PROFILES).join(", ")}.`,
    );
  }
  return PROFILES[name];
}

function parsePageCsv(csv: string): string[] {
  const names: string[] = [];
  for (const part of csv.split(",")) {
    const name = part.trim();
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

function selectedRawNames(): readonly string[] {
  const csv = process.env["SITE_PAGES"];
  if (csv !== undefined) {
    return parsePageCsv(csv);
  }
  return keysFromProfile(process.env["SITE_PROFILE"]);
}

function resolveMountedPages(names: readonly string[]): PageKey[] {
  const selected = new Set<PageKey>();
  for (const name of names) {
    if (isPageKey(name)) {
      selected.add(name);
      continue;
    }
    console.warn(`Unknown site page "${name}"; ignoring.`);
  }
  const mounted = PAGE_ORDER.filter((key) => selected.has(key));
  if (mounted.length === 0) {
    throw new Error(EMPTY_SET_MESSAGE);
  }
  return mounted;
}

/** Mounted pages in canonical order, from SITE_PAGES or SITE_PROFILE. */
export function enabledPages(): PageKey[] {
  return resolveMountedPages(selectedRawNames());
}

/** True when `key` is in the current mounted set. */
export function isPageMounted(key: PageKey): boolean {
  return enabledPages().includes(key);
}

/**
 * Landing page: `home` when mounted, otherwise the first mounted page
 * in canonical order.
 */
export function landing(): PageKey {
  const mounted = enabledPages();
  if (mounted.includes("home")) {
    return "home";
  }
  return mounted[0];
}

const PAGE_PATHS = {
  home: "",
  observatory: "observatory/",
  validator: "validator/",
  statistics: "validator/statistics/",
} as const satisfies Record<PageKey, string>;

/** Relative site path for `key` (home is the empty prefix). */
export function pagePath(key: PageKey): string {
  return PAGE_PATHS[key];
}

/**
 * Primary page from SITE_PRIMARY_PAGE, or landing() when unset,
 * unknown, or not mounted.
 */
export function primaryPage(): PageKey {
  const raw = readTrimmedEnv("SITE_PRIMARY_PAGE");
  if (raw === undefined) {
    return landing();
  }
  if (!isPageKey(raw)) {
    console.warn(`Unknown SITE_PRIMARY_PAGE "${raw}"; using landing page.`);
    return landing();
  }
  if (!isPageMounted(raw)) {
    console.warn(
      `SITE_PRIMARY_PAGE "${raw}" is not mounted; using landing page.`,
    );
    return landing();
  }
  return raw;
}

