// ResultsShell union-test facade over the canonical union DOM shim.
// Collapses the shared mount/teardown used by ResultsShell peel tests.

import { act } from "react";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
  type ShimDocument,
} from "@/components/validator/tests/helpers/domShim";
import { waitForText } from "@/components/validator/tests/helpers/wait";

export { installDomShim, reactDomContainerOf, ShimEvent, ShimNode };
export type { ShimDocument };

// A live shim render tree: the shim document, the mounted container, the React
// root, and act-wrapped render/unmount/waitForText plus the shim teardown. This
// mirrors the per-test "installDomShim + createRoot + act render + waitForText +
// restore" block used across ResultsShell's shim-strategy tests.
export interface ResultsShellHarness {
  readonly doc: ShimDocument;
  readonly container: ShimNode;
  readonly root: Root;
  render(element: ReactElement): Promise<void>;
  waitForText(needle: string, target?: ShimNode): Promise<void>;
  unmount(): Promise<void>;
  restore(): void;
}

// Install the union DOM shim, then load the client renderer and mount an empty
// container without rendering yet. The dynamic react-dom/client import must run
// after installDomShim so the renderer observes the shim globals, matching the
// hub's per-test ordering. Use this when a test asserts on the harness before
// its first render; otherwise prefer mountResultsShell.
export async function installResultsShellDom(): Promise<ResultsShellHarness> {
  const { document: doc, restore } = installDomShim();
  try {
    const { createRoot } = await import("react-dom/client");
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const root = createRoot(reactDomContainerOf(container));
    return {
      doc,
      container,
      root,
      render: async (element: ReactElement): Promise<void> => {
        await act(() => {
          root.render(element);
        });
      },
      waitForText: (needle: string, target?: ShimNode): Promise<void> =>
        waitForText(target ?? container, needle),
      unmount: async (): Promise<void> => {
        await act(() => {
          root.unmount();
        });
      },
      restore,
    };
  } catch (err) {
    restore();
    throw err;
  }
}

// Install the shim, mount, and render the element in one act pass. Replaces the
// per-test boilerplate with a single call; pair with harness.restore() (and the
// test's own fetch teardown) in a finally block.
export async function mountResultsShell(element: ReactElement): Promise<ResultsShellHarness> {
  const harness = await installResultsShellDom();
  await harness.render(element);
  return harness;
}
