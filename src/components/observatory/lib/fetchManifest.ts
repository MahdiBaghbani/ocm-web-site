export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  constructor(status: number, statusText: string, url: string) {
    super(`fetch failed: ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

export function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name?: unknown }).name === "AbortError",
  );
}

// Astro injects BASE_URL at build time; in the browser it is inlined.
export function getBaseUrl(): string {
  return import.meta.env.BASE_URL ?? "/";
}

export async function fetchJson<T = unknown>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new HttpError(res.status, res.statusText, url);
  return res.json() as Promise<T>;
}

export interface TruncatedText {
  text: string;
  truncated: boolean;
}

export async function fetchTruncatedText(
  url: string,
  capBytes: number,
  signal?: AbortSignal,
): Promise<TruncatedText> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new HttpError(res.status, res.statusText, url);

  if (!res.body) {
    const text = await res.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > capBytes) {
      const sliced = bytes.slice(0, capBytes);
      const decoded = new TextDecoder(undefined, { fatal: false }).decode(sliced);
      return { text: decoded, truncated: true };
    }
    return { text, truncated: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let chunks = "";
  let truncated = false;

  // Read until cap, then cancel.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received <= capBytes) {
      chunks += decoder.decode(value, { stream: true });
      continue;
    }

    // Keep only part of the last chunk.
    const over = received - capBytes;
    const keep = value.byteLength - over;
    if (keep > 0) {
      chunks += decoder.decode(value.slice(0, keep), { stream: true });
    }
    truncated = true;
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    break;
  }

  chunks += decoder.decode();
  return { text: chunks, truncated };
}
