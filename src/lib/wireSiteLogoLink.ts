/**
 * Client-side header logo wiring. Updates the anchor after runtime config loads.
 */

import {
  loadSharedRuntimeConfig,
  resolveSiteLogoHref,
  siteLogoLinkAttrs,
} from "./siteRuntimeConfig";

export const SITE_LOGO_LINK_ID = "site-logo-link";

export interface SiteLogoAnchor {
  href: string;
  target: string;
  rel: string;
  removeAttribute(name: string): void;
}

/** Apply runtime logo attributes to an existing header anchor. */
export function applySiteLogoLink(
  anchor: SiteLogoAnchor,
  baseUrl: string,
): Promise<void> {
  return loadSharedRuntimeConfig().then((config) => {
    const attrs = siteLogoLinkAttrs(resolveSiteLogoHref(config), baseUrl);
    anchor.href = attrs.href;
    if (attrs.target !== undefined) {
      anchor.target = attrs.target;
      anchor.rel = attrs.rel ?? "noopener noreferrer";
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  });
}

/** Find the site logo anchor and swap in the runtime href when config loads. */
export function wireSiteLogoLink(baseUrl: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const anchor = document.getElementById(SITE_LOGO_LINK_ID);
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }
  void applySiteLogoLink(anchor, baseUrl);
}
