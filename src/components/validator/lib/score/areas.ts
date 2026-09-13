/**
 * Canonical area identity plus the eight-area description catalog shared by
 * Results and AreaModal.
 */

export const CANONICAL_AREA_IDS = [
  "discovery",
  "tls",
  "jwks",
  "httpsig",
  "sharing",
  "notification",
  "token",
  "capability",
] as const;

export type CanonicalAreaId = (typeof CANONICAL_AREA_IDS)[number];

export const CANONICAL_AREA_LABELS = {
  discovery: "Server discovery",
  tls: "Secure connection",
  jwks: "Signing keys",
  httpsig: "Request signing",
  sharing: "Share exchange",
  notification: "Notifications",
  token: "Access tokens",
  capability: "Capabilities",
} as const satisfies Record<CanonicalAreaId, string>;

export const CANONICAL_AREA_TOTAL = CANONICAL_AREA_IDS.length;

const CANONICAL_AREA_SET: ReadonlySet<string> = new Set(CANONICAL_AREA_IDS);

export function isCanonicalAreaId(value: string): value is CanonicalAreaId {
  return CANONICAL_AREA_SET.has(value);
}

export const AREA_DESCRIPTIONS: Record<CanonicalAreaId, string> = {
  discovery: "Can other servers find this server's OCM endpoint?",
  tls: "Can the validator connect securely over HTTPS?",
  jwks: "Does the server publish a usable JWKS document?",
  httpsig: "Do HTTP signatures validate as the specification requires?",
  sharing: "Does it expose the expected remote sharing operations?",
  notification: "Does it send and accept the required notifications?",
  token: "Can it issue and accept the required access tokens?",
  capability: "Does the server advertise the required sharing features?",
};
