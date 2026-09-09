/**
 * Pure VALIDATOR_CONTACT normalizer. Bare email becomes mailto.
 */

export type ValidatorContactResult =
  | { ok: true; href: string; label: string }
  | { ok: false; reason: string };

function isBareEmail(value: string): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.includes(" ") || domain.includes(" ")) {
    return false;
  }
  if (value.includes(":") || value.includes("/")) {
    return false;
  }
  const dot = domain.lastIndexOf(".");
  if (dot <= 0 || dot === domain.length - 1) {
    return false;
  }
  return /^[a-zA-Z0-9._%+-]+$/.test(local) && /^[a-zA-Z0-9.-]+$/.test(domain);
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function urlHasUserinfo(value: string): boolean {
  const parsed = parsedUrl(value);
  return parsed !== null && (parsed.username !== "" || parsed.password !== "");
}

function isHttpUrl(value: string): boolean {
  const parsed = parsedUrl(value);
  return parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:");
}

// mailto:user:pass@host is opaque to URL(), so userinfo lives in the address.
function mailtoAddressHasUserinfo(address: string): boolean {
  const at = address.indexOf("@");
  if (at <= 0) {
    return false;
  }
  return address.slice(0, at).includes(":");
}

function fail(reason: string): ValidatorContactResult {
  return { ok: false, reason };
}

export function normalizeValidatorContact(raw: string): ValidatorContactResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return fail("contact is empty");
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith("mailto:")) {
    if (urlHasUserinfo(trimmed)) {
      return fail(`mailto address must not include URL credentials: "${trimmed}"`);
    }
    const address = trimmed.slice("mailto:".length).trim();
    if (mailtoAddressHasUserinfo(address)) {
      return fail(`mailto address must not include URL credentials: "${trimmed}"`);
    }
    if (!isBareEmail(address)) {
      return fail(`mailto address is invalid: "${trimmed}"`);
    }
    return { ok: true, href: `mailto:${address}`, label: trimmed };
  }

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    if (urlHasUserinfo(trimmed)) {
      return fail(`URL must not include credentials: "${trimmed}"`);
    }
    if (!isHttpUrl(trimmed)) {
      return fail(`URL is invalid: "${trimmed}"`);
    }
    return { ok: true, href: trimmed, label: trimmed };
  }

  if (isBareEmail(trimmed)) {
    return { ok: true, href: `mailto:${trimmed}`, label: trimmed };
  }

  return fail(
    `must be a bare email, mailto:, or http(s) URL. Got: "${trimmed}"`,
  );
}
