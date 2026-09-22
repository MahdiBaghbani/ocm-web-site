import { act } from "react";

import type { ShimNode } from "@/components/validator/tests/helpers/domShim";

// Preserves the 2000ms waitForText contract copied across the validator
// test harnesses: poll the shim container's text content until the needle
// shows up, yielding a macrotask between polls so pending state updates
// flush, or throw once the deadline passes.
export async function waitForText(container: ShimNode, needle: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!container.textContent.includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(needle)} in: ${container.textContent}`);
    }
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
}
