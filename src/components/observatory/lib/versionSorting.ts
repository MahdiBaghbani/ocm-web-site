export function parseVersionLine(v: unknown): number | null {
  const m = /^v(\d+)$/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

export function compareVersionLines(a: unknown, b: unknown): number {
  const na = parseVersionLine(a);
  const nb = parseVersionLine(b);
  if (na != null && nb != null) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

// Supports optional third sender segment (platform:version:build) for compat
// with older row keys; later matrix code collapses to platform:version.
export function compareAxisSenderKey(a: unknown, b: unknown): number {
  const [ap = "", av = "", ab = ""] = String(a ?? "").split(":");
  const [bp = "", bv = "", bb = ""] = String(b ?? "").split(":");
  const p = ap.localeCompare(bp);
  if (p !== 0) return p;
  const v = compareVersionLines(av, bv);
  if (v !== 0) return v;
  return ab.localeCompare(bb);
}

export function compareAxisReceiverKey(a: unknown, b: unknown): number {
  const [ap = "", av = ""] = String(a ?? "").split(":");
  const [bp = "", bv = ""] = String(b ?? "").split(":");
  const p = ap.localeCompare(bp);
  if (p !== 0) return p;
  return compareVersionLines(av, bv);
}
