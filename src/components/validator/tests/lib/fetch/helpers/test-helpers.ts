/**
 * Shared fetch-test helpers for validator fetch hubs. jsonResponse lives in
 * @/components/validator/tests/helpers/fetchStub; do not re-export it here.
 */

import type { FetchLike, ValidatorFetchDeps } from "@/components/validator/lib/fetch/types";

export const STORE_DOWN = { error: "store_error", message: "down" };

export function unreadResponse(status: number, onRead?: () => void): Response {
  const response = new Response("{}", { status });
  const fail = async (): Promise<string> => {
    onRead?.();
    throw new Error("body read failed");
  };
  Object.defineProperty(response, "text", { value: fail });
  Object.defineProperty(response, "json", { value: fail });
  return response;
}

export function captureFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchLike: FetchLike = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchLike, calls };
}

export function trackedSleep(): { sleeps: number[]; sleep: NonNullable<ValidatorFetchDeps["sleep"]> } {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms) => { sleeps.push(ms); } };
}
