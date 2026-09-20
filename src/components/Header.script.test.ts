import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const headerPath = join(dirname(fileURLToPath(import.meta.url)), "Header.astro");
const headerSource = readFileSync(headerPath, "utf8");

interface ScriptBlock {
  openingTag: string;
  body: string;
}

function stripFrontmatter(source: string): string {
  if (!source.startsWith("---")) {
    return source;
  }
  const end = source.indexOf("---", 3);
  if (end === -1) {
    return source;
  }
  return source.slice(end + 3);
}

function extractScriptBlocks(source: string): ScriptBlock[] {
  const withoutFrontmatter = stripFrontmatter(source);
  const blocks: ScriptBlock[] = [];
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(withoutFrontmatter)) !== null) {
    blocks.push({
      openingTag: match[1] ?? "",
      body: match[2] ?? "",
    });
  }
  return blocks;
}

function hasEsmImport(body: string): boolean {
  return /^\s*import\s+/m.test(body);
}

function hasDefineVars(openingTag: string): boolean {
  return /define:vars/.test(openingTag);
}

function isProcessedScript(openingTag: string): boolean {
  return !hasDefineVars(openingTag);
}

const scriptBlocks = extractScriptBlocks(headerSource);

describe("Header.astro client scripts", () => {
  test("does not put define:vars on a script that imports", () => {
    const offenders = scriptBlocks.filter(
      (block) => hasEsmImport(block.body) && hasDefineVars(block.openingTag),
    );
    expect(offenders).toEqual([]);
  });

  test("passes BASE_URL to the logo via data-base-url", () => {
    expect(headerSource).toContain("data-base-url={base}");
  });

  test("processed script still wires the logo and chrome", () => {
    const processed = scriptBlocks.filter((block) =>
      isProcessedScript(block.openingTag),
    );

    const hasWireSiteLogoLink = processed.some((block) =>
      block.body.includes("wireSiteLogoLink"),
    );
    expect(hasWireSiteLogoLink).toBe(true);

    const hasChromeSelectors = processed.some(
      (block) =>
        block.body.includes("mobile-menu-btn") &&
        block.body.includes("site-header"),
    );
    expect(hasChromeSelectors).toBe(true);
  });
});
