import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ValidatorShell, { ValidatorEntryForm } from "./ValidatorShell";

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
