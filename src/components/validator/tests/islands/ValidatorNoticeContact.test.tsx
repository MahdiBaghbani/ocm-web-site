import React, { act } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { createRoot } from "react-dom/client";

import { resetSharedRuntimeConfigForTests } from "@/lib/siteRuntimeConfig";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "@/components/validator/tests/helpers/domShim";
import { jsonResponse } from "@/components/validator/tests/helpers/fetchStub";
import { waitForText } from "@/components/validator/tests/helpers/wait";
import ValidatorNoticeContact from "@/components/validator/islands/ValidatorNoticeContact";

afterEach(() => {
  resetSharedRuntimeConfigForTests();
});

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

function findAnchor(root: ShimNode): ShimNode | null {
  let found: ShimNode | null = null;
  walk(root, (node) => {
    if (found === null && node.tagName === "A") {
      found = node;
    }
  });
  return found;
}

async function mountContact(configBody: Record<string, unknown>): Promise<{
  container: ShimNode;
  restore: () => void;
}> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request) => jsonResponse(200, configBody),
    { preconnect: previousFetch.preconnect.bind(previousFetch) },
  );
  const shim = installDomShim();
  const container = shim.document.createElement("div");
  shim.document.body.appendChild(container);
  const root = createRoot(reactDomContainerOf(container));
  await act(async () => {
    root.render(<ValidatorNoticeContact />);
  });
  return {
    container,
    restore: () => {
      globalThis.fetch = previousFetch;
      shim.restore();
    },
  };
}

async function settleEmpty(container: ShimNode): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  expect(findAnchor(container)).toBeNull();
  expect(container.textContent).not.toContain("@");
}

describe("ValidatorNoticeContact", () => {
  test("renders nothing when runtime contact is missing", async () => {
    const { container, restore } = await mountContact({});
    try {
      await settleEmpty(container);
    } finally {
      restore();
    }
  });

  test("renders nothing when runtime contact is invalid", async () => {
    const { container, restore } = await mountContact({
      validator_contact: "javascript:alert(1)",
    });
    try {
      await settleEmpty(container);
    } finally {
      restore();
    }
  });

  test("renders a contact link from runtime config", async () => {
    const { container, restore } = await mountContact({
      validator_contact: "ops@example.com",
    });
    try {
      await waitForText(container, "ops@example.com");
      const link = findAnchor(container);
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe("mailto:ops@example.com");
    } finally {
      restore();
    }
  });
});
