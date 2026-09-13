// Shared fetch-stub helpers for validator tests: build JSON responses, read
// a request URL off any fetch input shape, capture calls made through a
// fake fetch, and track synthetic sleep delays.

import type { ValidatorFetchDeps, FetchLike } from "../lib/validatorFetch";

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function captureFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetchLike: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchLike: FetchLike = async (input, init = {}) => {
    const url = requestUrl(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchLike, calls };
}

export function trackedSleep(): {
  sleeps: number[];
  sleep: NonNullable<ValidatorFetchDeps["sleep"]>;
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}
