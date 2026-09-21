import React, { act } from "react";
import { describe, expect, test } from "bun:test";

import StatisticsShell from "./StatisticsShell";
import {
  installDomShim,
  reactDomContainerOf,
  ShimNode,
} from "../test-helpers/domShim";
import { mockIslandFetch, readyStatistics } from "../test-helpers/statisticsFetch";
import { waitForText } from "../test-helpers/wait";

const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

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

function htmlOf(node: ShimNode): string {
  if (node.nodeType === TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.nodeType === DOCUMENT_NODE) {
    return node.childNodes.map(htmlOf).join("");
  }
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attrs.entries()]
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
  return `<${tag}${attrs}>${node.childNodes.map(htmlOf).join("")}</${tag}>`;
}

const TILE_VALUE_CLASS = "text-lg font-semibold text-zinc-100";

function tileValue(root: ShimNode, title: string): string {
  let found = "";
  walk(root, (node) => {
    if (node.tagName !== "H3" || node.textContent !== title) {
      return;
    }
    const card = node.parentNode?.parentNode;
    if (card === undefined || card === null) {
      return;
    }
    walk(card, (current) => {
      if (current.getAttribute("class") === TILE_VALUE_CLASS) {
        found = current.textContent;
      }
    });
  });
  return found;
}

describe("StatisticsShell island panels", () => {
  test("ready branch renders numeric tiles, platforms, and area-grade totals", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = mockIslandFetch(200, readyStatistics());
    const { document: doc, restore } = installDomShim();
    try {
      const { createRoot } = await import("react-dom/client");
      const container = doc.createElement("div");
      doc.body.appendChild(container);
      const root = createRoot(reactDomContainerOf(container));
      await act(() => {
        root.render(<StatisticsShell />);
      });
      await waitForText(container, "80%");
      findById(container, "validator-stats-days");
      findByTag(container, "select");
      const html = htmlOf(container);
      expect(tileValue(container, "Sessions")).toBe("10");
      expect(tileValue(container, "Unique hosts")).toBe("6");
      expect(tileValue(container, "Healthy")).toBe("80%");
      expect(html).toContain("nextcloud");
      expect(html).toContain("opencloud");
      expect(html).toContain("Area-grade totals");
      expect(html).not.toContain("Public totals stay at zero until");
      await act(() => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = previousFetch;
      restore();
    }
  });
});
