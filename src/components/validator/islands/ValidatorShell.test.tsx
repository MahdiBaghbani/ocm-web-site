import React, { act } from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ValidatorShell, { ValidatorEntryForm } from "./ValidatorShell";
import {
  installDomShim,
  reactDomContainerOf,
  ShimEvent,
  ShimNode,
} from "../test-helpers/domShim";
import { requestUrl, jsonResponse } from "../test-helpers/fetchStub";
import { waitForText } from "../test-helpers/wait";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

function checkboxChunk(html: string, id: string): string {
  const marker = `id="${id}"`;
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error(`missing checkbox ${id}`);
  }
  const from = html.lastIndexOf("<input", start);
  const to = html.indexOf(">", start);
  if (from === -1 || to === -1) {
    throw new Error(`unreadable checkbox ${id}`);
  }
  return html.slice(from, to + 1);
}

function isChecked(html: string, id: string): boolean {
  return /\schecked(?:="[^"]*")?/.test(checkboxChunk(html, id));
}

function isDisabled(html: string, id: string): boolean {
  return /\sdisabled(?:="[^"]*")?/.test(checkboxChunk(html, id));
}

const noopChange = (): void => undefined;
const noopSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
  event.preventDefault();
};

const readyForm = {
  target: "",
  onTargetChange: noopChange,
  optInPermanent: false,
  optInActive: false,
  optInStats: false,
  onOptInPermanentChange: noopChange,
  onOptInActiveChange: noopChange,
  onOptInStatsChange: noopChange,
  submitting: false,
  configReady: true,
  activeAvailable: true,
  manifestLoading: false,
  manifestFailed: false,
  hostError: "",
  formError: "",
  previewHost: null as string | null,
  onSubmit: noopSubmit,
};

describe("ValidatorShell entry form", () => {
  test("renders the form-first labels, hints, fieldset, and primary action", () => {
    const html = render(<ValidatorShell />);
    expect(html).toContain("Enter the server you want to check.");
    expect(html).toContain("Save a public report");
    expect(html).toContain("Saves the result after this session so anyone with the link can view it. The validator retention policy applies.");
    expect(html).toContain("Run active validation");
    expect(html).toContain(
      "Active test: you will accept an OCM invitation on the target server, paste its return invitation here, open a shared test file there, and share a file back. You need an account on the target server. Only one active test can run on that target at a time.",
    );
    expect(html).toContain("Contribute to public statistics");
    expect(html).toContain("Adds aggregate data after enough unique hosts are in the public window. It does not create a public report for this server.");
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("Optional settings");
    expect(html).toContain("Loading validator...");
    expect(html).toContain("Loading option...");
    expect(html.indexOf("Save a public report")).toBeLessThan(html.indexOf("Run active validation"));
    expect(html.indexOf("Run active validation")).toBeLessThan(
      html.indexOf("Contribute to public statistics"),
    );
    expect(isChecked(html, "validator-opt-in-permanent")).toBe(false);
    expect(isChecked(html, "validator-opt-in-active")).toBe(false);
    expect(isChecked(html, "validator-opt-in-stats")).toBe(false);
    expect(isDisabled(html, "validator-opt-in-active")).toBe(true);
    expect(html).toContain("min-h-11");
  });

  test("renders the manifest k in the stats opt-in hint", () => {
    const html = render(<ValidatorEntryForm {...readyForm} kAnonymityUniqueHosts={7} />);
    expect(html).toContain("Contribute to public statistics");
    expect(html).toContain("at least 7 unique hosts");
    expect(html).not.toContain("enough unique hosts");
  });

  test("keeps an unavailable active row visible and disabled", () => {
    const html = render(
      <ValidatorEntryForm
        {...readyForm}
        activeAvailable={false}
        manifestFailed={true}
      />,
    );
    expect(html).toContain("Run active validation");
    expect(html).toContain(
      "Active test: you will accept an OCM invitation on the target server, paste its return invitation here, open a shared test file there, and share a file back. You need an account on the target server. Only one active test can run on that target at a time.",
    );
    expect(isDisabled(html, "validator-opt-in-active")).toBe(true);
    expect(html).toContain("Extra scan options are unavailable. You can still run a basic check.");
    expect(html).not.toContain("Loading option...");
    expect(html).not.toContain("manifest unavailable:");
    expect(html).toContain("Check this server");
  });

  test("uses the exact primary action wording when ready", () => {
    const html = render(<ValidatorEntryForm {...readyForm} />);
    expect(html).toContain("Check this server");
    expect(html).not.toContain("Start scan");
    expect(html).not.toContain("Starting...");
  });

  test("pending state preserves form data", () => {
    const html = render(
      <ValidatorEntryForm
        {...readyForm}
        target="peer.example:8443"
        optInPermanent={true}
        optInStats={true}
        submitting={true}
        previewHost="peer.example:8443"
      />,
    );
    expect(html).toContain('value="peer.example:8443"');
    expect(html).toContain("Server to check: peer.example:8443");
    expect(isChecked(html, "validator-opt-in-permanent")).toBe(true);
    expect(isChecked(html, "validator-opt-in-stats")).toBe(true);
    expect(isChecked(html, "validator-opt-in-active")).toBe(false);
    expect(html).toContain("Starting check...");
    expect(html).not.toContain("Loading validator...");
  });

  test("always mounts the reserved preview node and wires aria-describedby when empty", () => {
    const html = render(<ValidatorShell />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).toContain('aria-describedby="validator-domain-help validator-host-preview"');
    expect(html).not.toContain("Server to check:");
  });

  test("reserved preview node stays empty when there is no host", () => {
    const html = render(<ValidatorEntryForm {...readyForm} />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).not.toContain("Server to check:");
  });

  test("reserved preview node renders the host when populated", () => {
    const html = render(<ValidatorEntryForm {...readyForm} previewHost="peer.example.com" />);
    expect(html).toContain('id="validator-host-preview"');
    expect(html).toContain('aria-describedby="validator-domain-help validator-host-preview"');
    expect(html).toContain("Server to check: peer.example.com");
  });
});

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
