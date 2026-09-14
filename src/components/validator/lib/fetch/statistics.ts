/**
 * Statistics endpoint: fetch a statistics window (GET, retried).
 */

import {
  parseValidatorStatistics,
  statisticsDaysSelector,
  type ValidatorStatistics,
} from "../validatorStatistics";
import { validatorRequest } from "./transport";
import type { ValidatorFetchDeps, ValidatorResult } from "./types";

export function fetchStatistics(
  daysSelector?: string | number,
  deps?: ValidatorFetchDeps,
): Promise<ValidatorResult<ValidatorStatistics>> {
  const days = statisticsDaysSelector(daysSelector);
  const path = `/api/statistics?days=${encodeURIComponent(days)}`;
  return validatorRequest({ method: "GET", path, parse: parseValidatorStatistics, retry: true }, deps);
}
