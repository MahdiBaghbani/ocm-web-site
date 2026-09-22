import React from "react";
import { describe, expect, test } from "bun:test";

import DomainField from "@/components/validator/atoms/DomainField";
import { render } from "@/components/validator/tests/atoms/helpers/test-helpers";

describe("DomainField", () => {
  test("renders a labeled read-only domain value", () => {
    const html = render(<DomainField value="peer.example:8443" />);
    expect(html).toContain("Server address");
    expect(html).toContain("peer.example:8443");
    expect(html).toContain("readOnly");
  });

  test("renders an editable field with an error", () => {
    const html = render(
      <DomainField label="Target host" value="bad host" error="Enter a host" onChange={() => undefined} />,
    );
    expect(html).toContain("Target host");
    expect(html).toContain("Enter a host");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("readOnly");
  });

  test("composes aria-describedby from helper, preview, and error", () => {
    const html = render(
      <DomainField
        value="bad host"
        helperText="Use a domain, IP address, or http/https URL."
        helperId="validator-domain-help"
        previewId="validator-host-preview"
        error="Enter a server address."
        onChange={() => undefined}
      />,
    );
    expect(html).toContain(
      'aria-describedby="validator-domain-help validator-host-preview validator-domain-error"',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="validator-domain-help"');
    expect(html).toContain("Use a domain, IP address, or http/https URL.");
    expect(html).toContain('id="validator-domain-error"');
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain('autoComplete="email"');
    expect(html).not.toContain('autoComplete="url"');
    expect(html).not.toContain('autoComplete="username"');
    expect(html).not.toContain('autoComplete="current-password"');
  });
});
