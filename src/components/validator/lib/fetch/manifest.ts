/**
 * Manifest endpoint: fetch the federation tester manifest (GET, retried).
 */

import { parseValidatorManifest, type ValidatorManifest } from "../validatorManifest";
import { validatorRequest } from "./transport";
import type { ValidatorFetchDeps, ValidatorResult } from "./types";

export function fetchManifest(deps?: ValidatorFetchDeps): Promise<ValidatorResult<ValidatorManifest>> {
  return validatorRequest({ method: "GET", path: "/api/manifest", parse: parseValidatorManifest, retry: true }, deps);
}
