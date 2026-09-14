/**
 * Typed ocmgo validator transport. Thin barrel over the ./fetch modules;
 * see ./fetch/index for the transport kernel and endpoint split.
 */

export {
  claimInvite,
  fetchManifest,
  fetchReport,
  fetchStatistics,
  isReportNotPublicFailure,
  joinValidatorUrl,
  normalizeReportVisibility,
  parseErrorEnvelope,
  parseRetryAfter,
  pollSession,
  postReverseInvite,
  REPORT_NOT_PUBLIC_ERROR,
  REPORT_VISIBILITY,
  resolvePublicReportUrl,
  startSession,
  stopSession,
  VALIDATOR_SERVICE_PREFIX,
  waitForBackoff,
} from "./fetch/index";
export type {
  ClaimInviteResponse,
  FetchLike,
  ParsedErrorEnvelope,
  ReportResponse,
  ReportVisibility,
  ReverseInviteResponse,
  SessionPollResponse,
  StartSessionRequest,
  StartSessionResponse,
  StopSessionResponse,
  ValidatorFailure,
  ValidatorFailureKind,
  ValidatorFetchDeps,
  ValidatorResult,
  ValidatorSuccess,
  WaitResult,
} from "./fetch/index";
