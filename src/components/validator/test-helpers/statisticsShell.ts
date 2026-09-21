// Shared DOM-walk helpers for StatisticsShell panel tests.
// Copied from the pre-split StatisticsShell hub; behavior is unchanged.

import type { ShimNode } from "./domShim";

const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

function walk(node: ShimNode, visit: (current: ShimNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    walk(child, visit);
  }
}

export function findById(root: ShimNode, id: string): ShimNode {
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

export function findByTag(root: ShimNode, tagName: string): ShimNode {
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

export function htmlOf(node: ShimNode): string {
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

export function tileValue(root: ShimNode, title: string): string {
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
