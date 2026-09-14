/**
 * Report endpoint: fetch a validation report by id (GET, retried).
 */

import { isRecord } from "../validatorShared";
import { readString, validatorRequest } from "./transport";
import { normalizeReportVisibility } from "./urls";
import type {
  ReportResponse,
  ValidatorFetchDeps,
  ValidatorResult,
} from "./types";

function parseReportResponse(body: unknown): ReportResponse | null {
  if (!isRecord(body)) {
    return null;
  }
  const schema = readString(body.schema);
  const id = readString(body.id);
  const visibilityRaw = readString(body.visibility);
  if (schema === null || id === null || visibilityRaw === null) {
    return null;
  }
  const parsed: ReportResponse = {
    schema,
    id,
    visibility: normalizeReportVisibility(visibilityRaw),
  };
  const reportUrl = readString(body.reportUrl);
  if (reportUrl !== null) parsed.reportUrl = reportUrl;
  const url = readString(body.url);
  if (url !== null) parsed.url = url;
  if ("score" in body) parsed.score = body.score;
  if ("evidence" in body) parsed.evidence = body.evidence;
  if ("retentionTier" in body && (typeof body.retentionTier === "string" || body.retentionTier === null)) {
    parsed.retentionTier = body.retentionTier;
  }
  return parsed;
}

export function fetchReport(id: string, deps?: ValidatorFetchDeps): Promise<ValidatorResult<ReportResponse>> {
  return validatorRequest({
    method: "GET",
    path: `/api/report/${encodeURIComponent(id)}`,
    parse: parseReportResponse,
    retry: true,
  }, deps);
}
