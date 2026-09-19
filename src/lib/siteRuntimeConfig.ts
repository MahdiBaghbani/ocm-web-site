/**
 * Shared /config.json load. One in-flight fetch is reused by the header,
 * notice contact, and validator islands.
 */

import {
  fetchConfigSource,
  loadValidatorConfig,
  type FetchLike,
  type ValidatorRuntimeConfig,
} from "../components/validator/lib/validatorConfig";

const EXTERNAL_HREF = /^https?:\/\//;

let sharedLoad: Promise<ValidatorRuntimeConfig> | null = null;

function currentGlobalFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return globalThis.fetch(input, init);
}

/**
 * Load runtime config once and reuse the same promise for every consumer.
 * Tests may inject a fetch implementation; production omits it and reads
 * the current global fetch at request time.
 */
export function loadSharedRuntimeConfig(
  fetchLike?: FetchLike,
): Promise<ValidatorRuntimeConfig> {
  if (sharedLoad === null) {
    sharedLoad = loadValidatorConfig(
      fetchConfigSource(fetchLike ?? currentGlobalFetch),
    );
  }
  return sharedLoad;
}

/** Test hook: clear the module-level cache between cases. */
export function resetSharedRuntimeConfigForTests(): void {
  sharedLoad = null;
}

/** Logo target: explicit logo href, else community URL (empty stays empty). */
export function resolveSiteLogoHref(config: ValidatorRuntimeConfig): string {
  const logo = config.logoHref.trim();
  if (logo !== "") {
    return logo;
  }
  return config.communityUrl.trim();
}

export interface SiteLogoLinkAttrs {
  href: string;
  target?: string;
  rel?: string;
}

function fallbackLogoHref(baseUrl: string): string {
  return baseUrl === "" || baseUrl === "/" ? "/" : baseUrl;
}

/** Map a raw logo/community href to anchor attributes. */
export function siteLogoLinkAttrs(
  rawHref: string,
  baseUrl: string,
): SiteLogoLinkAttrs {
  if (rawHref === "") {
    return { href: fallbackLogoHref(baseUrl) };
  }

  if (EXTERNAL_HREF.test(rawHref)) {
    return {
      href: rawHref,
      target: "_blank",
      rel: "noopener noreferrer",
    };
  }

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = rawHref.startsWith("/") ? rawHref.slice(1) : rawHref;
  return { href: `${base}${path}` };
}
