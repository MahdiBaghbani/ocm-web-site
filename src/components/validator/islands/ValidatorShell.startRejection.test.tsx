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

function findAlert(root: ShimNode): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.getAttribute("role") === "alert") {
      found = node;
    }
  });
  if (found === null) {
    throw new Error("missing role=alert");
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

function driveCheckbox(node: ShimNode, checked: boolean): void {
  const protoSet = Object.getOwnPropertyDescriptor(ShimNode.prototype, "checked")?.set;
  if (protoSet === undefined) {
    throw new Error("missing checked setter");
  }
  protoSet.call(node, checked);
  const onChange = reactChangeProps(node).onChange;
  if (onChange === undefined) {
    throw new Error("missing checkbox onChange");
  }
  onChange({ target: node });
}

function findSubmit(root: ShimNode): ShimNode {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (node.tagName === "BUTTON" && (node.type === "submit" || node.getAttribute("type") === "submit")) {
      found = node;
    }
  });
  if (found === null) {
    throw new Error("missing submit button");
  }
  return found;
}

describe("ValidatorShell start rejection", () => {
  test("submit preserves values after API failure", async () => {
    const failureMessage = "Could not start the scan.";
    const previousFetch = globalThis.fetch;
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
        return jsonResponse(503, { error: "start_failed", message: failureMessage });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });

      const permanent = findById(container, "validator-opt-in-permanent");
      const stats = findById(container, "validator-opt-in-stats");
      await act(() => {
        driveCheckbox(permanent, true);
        driveCheckbox(stats, true);
      });

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      await waitForText(container, failureMessage);

      expect(findById(container, "validator-domain").value).toBe("peer.example");
      expect(findById(container, "validator-opt-in-permanent").checked).toBe(true);
      expect(findById(container, "validator-opt-in-stats").checked).toBe(true);
      const alert = findAlert(container);
      expect(alert.textContent).toContain(failureMessage);
      const submit = findSubmit(container);
      expect(submit.disabled).toBe(false);
      expect(container.textContent).toContain("Check this server");
      expect(container.textContent).not.toContain("Starting check...");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });

  test("submit surfaces a fallback when the start API returns an empty message", async () => {
    const fallbackMessage = "Could not start the scan.";
    const previousFetch = globalThis.fetch;
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
        return jsonResponse(503, { error: "start_failed", message: "" });
      }
      return jsonResponse(404, { error: "missing", message: "missing" });
    }) as typeof fetch;

    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<ValidatorShell />);
      });
      await waitForText(container, "Check this server");

      const host = findById(container, "validator-domain");
      await act(() => {
        driveText(host, "peer.example");
      });

      const form = findByTag(container, "form");
      await act(() => {
        form.dispatchEvent(new ShimEvent("submit"));
      });
      await waitForText(container, fallbackMessage);

      const alert = findAlert(container);
      expect(alert.textContent).toContain(fallbackMessage);
      const submit = findSubmit(container);
      expect(submit.disabled).toBe(false);
      expect(container.textContent).toContain("Check this server");
      expect(container.textContent).not.toContain("Starting check...");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
