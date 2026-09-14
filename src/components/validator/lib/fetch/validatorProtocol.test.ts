import { describe, expect, test } from "bun:test";

import { waitForBackoff } from "./transport";

describe("waitForBackoff", () => {
  test("uses an injected timer and returns aborted when cancelled", async () => {
    let cleared = false;
    await expect(waitForBackoff(50, {
      setTimeoutFn: (handler) => { handler(); return 1; },
      clearTimeoutFn: () => { cleared = true; },
    })).resolves.toEqual({ ok: true });
    expect(cleared).toBe(true);
    const controller = new AbortController();
    const pending = waitForBackoff(60_000, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ ok: false, reason: "aborted" });
  });
});
