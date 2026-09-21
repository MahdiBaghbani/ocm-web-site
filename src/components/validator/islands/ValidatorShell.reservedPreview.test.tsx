import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import ValidatorShell from "./ValidatorShell";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
} from "../test-helpers/domShim";
import { requestUrl, jsonResponse } from "../test-helpers/fetchStub";
import { waitForText } from "../test-helpers/wait";

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function findById(root: ShimNode, id: string): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.id === id || node.getAttribute("id") === id) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing #${id}`);
  }
  return found;
}

function findByTag(root: ShimNode, tagName: string): ShimNode {
  const upper = tagName.toUpperCase();
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.tagName === upper && found === null) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error(`missing <${tagName}>`);
  }
  return found;
}

function reactChangeProps(node: ShimNode): {
  onChange?: (event: { target: ShimNode }) => void;
} {
  const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactProps"));
  if (key === undefined) {
    throw new Error("missing react props");
  }
  return (node as unknown as Record<string, { onChange?: (event: { target: ShimNode }) => void }>)[key];
}

function driveText(node: ShimNode, value: string): void {
  const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "value")?.set;
  if (protoSet === undefined) {
    throw new Error("missing value setter");
  }
  protoSet.call(node, value);
  const onChange = reactChangeProps(node).onChange;
  if (onChange === undefined) {
    throw new Error("missing text onChange");
  }
  onChange({ target: node });
}

describe("ValidatorShell reserved preview", () => {
  test("blur populates the reserved node and immediate submit still starts the scan", async () => {
    const previousFetch = globalThis.fetch;
    let startCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("config.json")) {
        return jsonResponse(200, {
          poll_interval_ms: 1,
          active_poll_interval_ms: 1,
          backoff_initial_ms: 1,
          backoff_max_ms: 1,
          request_timeout_ms: 5000,
        });
      }
      if (url.includes("/api/manifest")) {
        return jsonResponse(404, { error: "missing", message: "missing" });
      }
      if (method === "POST" && url.includes("/start")) {
        startCalled = true;
        return jsonResponse(200, { id: "scan-1", optInStats: false, optInPermanent: false });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    let assigned = "";
    if (doc.defaultView !== null) {
      doc.defaultView.location.assign = (href: string): void => {
        assigned = href;
      };
    }
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const reservedBefore = findById(container, "validator-host-preview");
      expect(reservedBefore.textContent).toBe("");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });
      await act(() => {
        host.dispatchEvent(new ShimEvent("focusout"));
      });

      const reservedAfter = findById(container, "validator-host-preview");
      expect(reservedAfter.textContent).toContain("Server to check: peer.example");

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      const deadline = Date.now() + 2000;
      while (!startCalled && Date.now() < deadline) {
        await act(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          });
        });
      }
      expect(startCalled).toBe(true);
      expect(assigned).toContain("/validator/results");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
