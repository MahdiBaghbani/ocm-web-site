/**
 * Validator URL joining and public report URL resolution helpers.
 */

import { REPORT_NOT_PUBLIC_ERROR, VALIDATOR_SERVICE_PREFIX } from "./types";
import type { ReportVisibility, ValidatorFailure } from "./types";

export function joinValidatorUrl(origin: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const fullPath = `${VALIDATOR_SERVICE_PREFIX}${normalizedPath}`;
  const trimmedOrigin = origin.trim().replace(/\/+$/, "");
  return trimmedOrigin === "" ? fullPath : `${trimmedOrigin}${fullPath}`;
}

export function normalizeReportVisibility(value: unknown): ReportVisibility {
  if (
    value === "session" ||
    value === "permanent" ||
    value === "not_saved" ||
    value === "expired"
  ) {
    return value;
  }
  return "unknown";
}

export function isReportNotPublicFailure(failure: ValidatorFailure): boolean {
  return failure.error === REPORT_NOT_PUBLIC_ERROR;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveUrlBase(validatorApiOrigin: string | null | undefined): string | null {
  if (typeof validatorApiOrigin !== "string") {
    return null;
  }
  const trimmed = validatorApiOrigin.trim();
  return trimmed === "" ? null : trimmed;
}

/** Resolve a public report URL against the validator API origin. */
export function resolvePublicReportUrl(
  candidate: string | null | undefined,
  validatorApiOrigin: string | null | undefined,
): string | null {
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim();
  if (trimmed === "") {
    return null;
  }
  const base = resolveUrlBase(validatorApiOrigin);
  if (base === null) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    const expected = originOf(base);
    if (expected === null || resolved.origin !== expected) {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}
