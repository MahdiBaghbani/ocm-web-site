// Shared atom render and query helpers for validator atom tests. Built over
// the canonical union DOM shim; this module does not install a second global.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ShimNode } from "../test-helpers/domShim";

export function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

export function countAttr(html: string, attr: string): number {
  return html.split(attr).length - 1;
}

export const FILE_VIEWER_CHIP = 'data-testid="file-viewer-chip"';
const FILE_VIEWER_CHIP_SURFACE = "rounded-xl border border-zinc-800 bg-zinc-900/30";

export function countChipsInFileViewerPanel(html: string): number {
  const panelCount = countAttr(html, FILE_VIEWER_CHIP);
  return panelCount !== 1 ? panelCount : countAttr(html, FILE_VIEWER_CHIP_SURFACE);
}

export function pillLabels(html: string): string[] {
  const pillLabelRe =
    /data-pill-kind="[^"]*"[^>]*><span[^>]*aria-hidden="true"><\/span>([^<]*)<\/span>/g;
  return [...html.matchAll(pillLabelRe)].map((match) => match[1]);
}

export function firstPillLabel(html: string): string | null {
  const labels = pillLabels(html);
  return labels.length === 0 ? null : labels[0];
}

export function iconSlotMarkup(html: string): string {
  const match = /data-icon="[^"]+"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (match === null) {
    throw new Error("missing data-icon slot");
  }
  return match[1];
}

export function svgInnerMarkup(html: string): string {
  const match = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  if (match === null) {
    throw new Error("missing svg");
  }
  return match[1];
}

function areaCardHtml(html: string, title: string): string {
  const heading = `>${title}</h3>`;
  const start = html.indexOf(heading);
  if (start === -1) throw new Error(`missing area heading: ${title}`);
  const rest = html.slice(start + heading.length);
  const next = rest.indexOf('<h3 class="text-sm font-semibold text-zinc-100">');
  return next === -1 ? rest : rest.slice(0, next);
}

export function areaGradeText(html: string, title: string): string {
  const card = areaCardHtml(html, title);
  const label = firstPillLabel(card);
  if (label === null) throw new Error(`missing grade pill for ${title}`);
  return label;
}

export function areaRateText(html: string, title: string): string {
  const card = areaCardHtml(html, title);
  const match = /<div class="text-lg font-semibold text-zinc-100">([^<]*)<\/div>/.exec(
    card,
  );
  if (match === null) throw new Error(`missing rate for ${title}`);
  return match[1];
}

export function areaResultCardHtml(html: string, areaId: string): string {
  const attr = `data-area-card="${areaId}"`;
  const attrAt = html.indexOf(attr);
  if (attrAt === -1) throw new Error(`missing data-area-card: ${areaId}`);
  const start = html.lastIndexOf("<article", attrAt);
  if (start === -1) throw new Error(`missing article for ${areaId}`);
  const rest = html.slice(start);
  const close = rest.indexOf("</article>");
  return close === -1 ? rest : rest.slice(0, close + "</article>".length);
}

export function stepIndexNumeral(html: string): string | null {
  const match =
    /<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-200">(\d+)<\/span>/.exec(
      html,
    );
  return match === null ? null : match[1];
}

function firstTag(html: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(html);
  if (match === null) {
    throw new Error(`missing ${label}`);
  }
  return match[0];
}

export function rootCardTag(html: string): string {
  return firstTag(html, /<div[^>]*>/, "root card");
}

export function primaryButtonTag(html: string): string {
  return firstTag(html, /<button[^>]*>/, "primary button");
}

export function guidanceSlotTag(html: string): string {
  return firstTag(html, /<div[^>]*data-guidance-slot[^>]*>/, "guidance slot");
}

export function statusCaptionTag(html: string): string {
  return firstTag(
    html,
    /<div class="[^"]*">(?:pending|current|complete)<\/div>/,
    "status caption",
  );
}

export function ctaSlotTag(html: string): string {
  return firstTag(html, /<div[^>]*data-cta-slot[^>]*>/, "cta slot");
}

export function secondaryLinkTag(html: string): string {
  return firstTag(html, /<a[^>]*>/, "secondary link");
}

export function hasNonAscii(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) > 127) {
      return true;
    }
  }
  return false;
}

export function actionButtonIds(html: string): string[] {
  const idRe = /<button[^>]*\sid="(area-card-[^"]+-action)"/g;
  return [...html.matchAll(idRe)].map((match) => match[1]);
}

export function actionButtonLabelledby(html: string, areaId: string): string | null {
  const buttonRe = new RegExp(
    `<button[^>]*\\sid="area-card-${areaId}-action"[^>]*>`,
  );
  const match = buttonRe.exec(html);
  if (match === null) {
    return null;
  }
  const labelledby = /aria-labelledby="([^"]+)"/.exec(match[0]);
  return labelledby === null ? null : labelledby[1];
}

export function findNode(node: ShimNode, match: (candidate: ShimNode) => boolean): ShimNode | null {
  if (match(node)) return node;
  for (const child of node.childNodes) {
    const found = findNode(child, match);
    if (found !== null) return found;
  }
  return null;
}
