/**
 * Reason-slug copy map and resolver for validator evidence rows.
 * Ships four confirmed backend slugs plus an acronym-aware titleize and a
 * conservative fallback for unknown or missing slugs. Pure, no React imports.
 * See probe_persist.go:19-27 for the backend slug constants.
 */

export type ReasonSeverity = "pass" | "warn" | "fail" | "info";

export interface ReasonCopy {
  title: string;
  why: string;
  remedy?: string;
}

export type ReasonCopySource = "map" | "titleize" | "missing";

export interface ResolvedReasonCopy extends ReasonCopy {
  source: ReasonCopySource;
  slug?: string;
  affectsGrade?: boolean;
  gradeSpecific?: boolean;
  // Resolved outcome for this row. For a grade-specific slug this is the
  // entry's fixed grade and does not depend on caller-supplied severity.
  grade?: ReasonSeverity;
}

/**
 * A confirmed map entry. gradeSpecific is true only when the slug itself
 * carries the outcome (jwks_unadvertised is warn-only); grade-agnostic
 * "probed" slugs leave the outcome to the passed severity/grade. When
 * gradeSpecific is true, fixedGrade names the grade the slug always carries.
 */
export interface ReasonMapEntry extends ReasonCopy {
  affectsGrade: boolean;
  gradeSpecific: boolean;
  fixedGrade?: ReasonSeverity;
}

export interface ReasonResolveInput {
  reasonCode?: string;
  grade?: ReasonSeverity | null;
  severity?: string;
  affectsGrade?: boolean;
}

const MISSING_TITLE = "Check note";

const MISSING_WHY =
  "This evidence item has no reason code, so the page cannot explain what was observed.";

const UNKNOWN_WHY =
  "The validator reported this check, but the page has no explanation for this reason code yet.";

const UNKNOWN_REMEDY =
  "Open the full report JSON and compare this server with the OCM specification for this area.";

/**
 * Display tokens that stay as a fixed acronym instead of being title-cased.
 * Lower-case keys; the split is on "_" and "-" before lookup.
 */
const ACRONYMS: Record<string, string> = {
  api: "API",
  http: "HTTP",
  https: "HTTPS",
  httpsig: "HTTPSig",
  jwks: "JWKS",
  ocm: "OCM",
  tls: "TLS",
  url: "URL",
};

/**
 * The four confirmed slugs. All set affectsGrade true. jwks_unadvertised is
 * grade-specific (warn only); the three "probed" slugs are grade-agnostic and
 * describe what was checked, leaving the outcome to Severity. well_known_ok is
 * deliberately absent so it falls through to the conservative fallback.
 */
export const VALIDATOR_REASONS: Record<string, ReasonMapEntry> = {
  jwks_unadvertised: {
    title: "Signing keys not advertised",
    why: "The discovery document did not publish a jwksUri and did not advertise the http-sig capability, so signing keys are optional and the validator did not fetch a key set.",
    remedy:
      "If this server should sign requests, publish an https jwksUri and advertise the http-sig capability; otherwise no change is needed.",
    affectsGrade: true,
    gradeSpecific: true,
    fixedGrade: "warn",
  },
  discovery_probed: {
    title: "Discovery endpoint checked",
    why: "The validator sent an uncached GET to /.well-known/ocm and assessed the returned JSON discovery document. The pass, warn, or fail verdict is shown separately.",
    remedy:
      "Publish a 200 JSON document at /.well-known/ocm with enabled true and the required apiVersion, endPoint, and resourceTypes.",
    affectsGrade: true,
    gradeSpecific: false,
  },
  tls_probed: {
    title: "TLS handshake probed",
    why: "During the discovery fetch the validator opened a TLS connection and assessed the handshake, leaf certificate validity, protocol version, and cipher suite. OCM discovery SHOULD use HTTPS, with HTTP only as a testing fallback.",
    remedy:
      "Serve discovery over HTTPS with a valid certificate, TLS 1.2 or newer, and a secure cipher suite.",
    affectsGrade: true,
    gradeSpecific: false,
  },
  httpsig_probed: {
    title: "HTTP signature probe",
    why: "The validator sent two signed GET requests to a dummy probe path: one with an intact RFC 9421 signature and one with a broken Signature header. A peer that verifies HTTP Message Signatures should not return the same status for both.",
    remedy:
      "Turn on inbound RFC 9421 signature verification (http-sig, or must-use-http-sig to reject unsigned requests) so a tampered signature is rejected.",
    affectsGrade: true,
    gradeSpecific: false,
  },
};

function normalizeOutcome(input: ReasonResolveInput): ReasonSeverity | null {
  const grade = input.grade;
  if (grade === "pass" || grade === "warn" || grade === "fail" || grade === "info") {
    return grade;
  }
  if (typeof input.severity === "string") {
    const lower = input.severity.trim().toLowerCase();
    if (lower === "pass" || lower === "warn" || lower === "fail" || lower === "info") {
      return lower;
    }
  }
  return null;
}

/** Remedy shows only for a warn or fail outcome, and never when grade is unaffected. */
function remedyAllowed(outcome: ReasonSeverity | null, affectsGrade: boolean | undefined): boolean {
  if (outcome !== "warn" && outcome !== "fail") {
    return false;
  }
  return affectsGrade !== false;
}

/**
 * Acronym-aware titleization. Splits on "_" and "-", keeps known acronyms
 * uppercase (JWKS, TLS, HTTPSig, ...), title-cases every other token, and
 * falls back to "Check note" when no tokens survive.
 */
export function titleizeSlug(slug: string): string {
  const tokens = slug
    .split(/[_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return MISSING_TITLE;
  }
  const words = tokens.map((token) => {
    const lower = token.toLowerCase();
    const acronym = Object.hasOwn(ACRONYMS, lower) ? ACRONYMS[lower] : undefined;
    if (acronym !== undefined) {
      return acronym;
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  return words.join(" ");
}

/**
 * Resolve reason copy for one evidence slug plus its severity/outcome.
 * Returns map copy for the four confirmed slugs, an acronym-aware titleize for
 * unknown slugs, and a conservative note for a missing slug. Remedy is present
 * only for a warn or fail outcome that affects the grade.
 */
export function reasonCopyFor(input: ReasonResolveInput): ResolvedReasonCopy {
  const slug = typeof input.reasonCode === "string" ? input.reasonCode.trim() : "";
  const outcome = normalizeOutcome(input);

  if (slug === "") {
    return { title: MISSING_TITLE, why: MISSING_WHY, source: "missing" };
  }

  const entry = Object.hasOwn(VALIDATOR_REASONS, slug) ? VALIDATOR_REASONS[slug] : undefined;
  if (entry !== undefined) {
    // A grade-specific slug carries its own outcome, so the entry's fixed
    // grade wins over any caller-supplied severity/grade. Grade-agnostic
    // slugs keep the caller-driven outcome.
    const effectiveOutcome = entry.fixedGrade ?? outcome;
    const affectsGrade = input.affectsGrade ?? entry.affectsGrade;
    const resolved: ResolvedReasonCopy = {
      title: entry.title,
      why: entry.why,
      source: "map",
      slug,
      affectsGrade,
      gradeSpecific: entry.gradeSpecific,
    };
    if (effectiveOutcome !== null) {
      resolved.grade = effectiveOutcome;
    }
    if (entry.remedy !== undefined && remedyAllowed(effectiveOutcome, affectsGrade)) {
      resolved.remedy = entry.remedy;
    }
    return resolved;
  }

  // Unknown non-empty slug (including well_known_ok): conservative fallback.
  const resolved: ResolvedReasonCopy = {
    title: titleizeSlug(slug),
    why: UNKNOWN_WHY,
    source: "titleize",
    slug,
  };
  if (remedyAllowed(outcome, input.affectsGrade)) {
    resolved.remedy = UNKNOWN_REMEDY;
  }
  return resolved;
}
