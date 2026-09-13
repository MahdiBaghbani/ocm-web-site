/**
 * Lib-owned eight-area description catalog shared by Results and AreaModal.
 */
import type { CanonicalAreaId } from "../validatorScore";

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
