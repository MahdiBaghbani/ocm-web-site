/**
 * Public barrel for RESULTS island slots and hooks. Named re-exports only.
 */

export { ActionSection } from "./ActionSection";
export {
  EvidenceSection,
  EVIDENCE_EMPTY_SNAPSHOT,
  EVIDENCE_EXPIRED,
  EVIDENCE_NOT_SAVED,
} from "./EvidenceSection";
export {
  CopyNoticeRegion,
  INVITE_FIELD_LABEL,
  MAX_REVERSE_INVITE_LENGTH,
  ProgressSection,
  REVERSE_INVITE_FIELD_LABEL,
  REVERSE_INVITE_SUBMIT_LABEL,
  REVERSE_INVITE_TOO_LONG_TEXT,
} from "./ProgressSection";
export type { CopyNotice } from "./ProgressSection";
export { PAGE_LINK_NOT_SAVED_NOTICE, ResultsHeader } from "./ResultsHeader";
export {
  CLAIM_COPY_FAILURE_TEXT,
  readStoredInvite,
  useClaimAction,
  writeStoredInvite,
} from "./useClaimAction";
export {
  COPY_SUCCESS_TEXT,
  copyText,
  EMPTY_COPY_NOTICE,
  useClipboardActions,
} from "./useClipboardActions";
export type { ClipboardCopyTarget } from "./useClipboardActions";
export { useResultPolling } from "./useResultPolling";
export { syncSessionIdentity, useResultSession } from "./useResultSession";
export { reverseInviteErrorCopy, useReverseInvite } from "./useReverseInvite";
