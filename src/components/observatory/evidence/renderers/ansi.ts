import React from "react";

const FG: Record<number, string> = {
  30: "text-zinc-900",
  31: "text-red-400",
  32: "text-green-400",
  33: "text-yellow-400",
  34: "text-blue-400",
  35: "text-fuchsia-400",
  36: "text-cyan-400",
  37: "text-zinc-200",
  90: "text-zinc-500",
  91: "text-red-300",
  92: "text-green-300",
  93: "text-yellow-300",
  94: "text-blue-300",
  95: "text-fuchsia-300",
  96: "text-cyan-300",
  97: "text-white",
};

const BG: Record<number, string> = {
  40: "bg-zinc-950",
  41: "bg-red-900",
  42: "bg-green-900",
  43: "bg-yellow-900",
  44: "bg-blue-900",
  45: "bg-fuchsia-900",
  46: "bg-cyan-900",
  47: "bg-zinc-100",
  100: "bg-zinc-800",
  101: "bg-red-800",
  102: "bg-green-800",
  103: "bg-yellow-800",
  104: "bg-blue-800",
  105: "bg-fuchsia-800",
  106: "bg-cyan-800",
  107: "bg-zinc-50",
};

interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
}

function applyCode(style: Style, code: number): Style {
  if (code === 0) return {};
  if (code === 1) return { ...style, bold: true };
  if (code === 2) return { ...style, dim: true };
  if (code === 22) return { ...style, bold: false, dim: false };
  if (code === 39) return { ...style, fg: undefined };
  if (code === 49) return { ...style, bg: undefined };
  const fgCls = FG[code];
  if (fgCls !== undefined) return { ...style, fg: fgCls };
  const bgCls = BG[code];
  if (bgCls !== undefined) return { ...style, bg: bgCls };
  return style;
}

function styleToClass(style: Style): string {
  const parts: string[] = [];
  if (style.fg) parts.push(style.fg);
  if (style.bg) parts.push(style.bg);
  if (style.bold) parts.push("font-bold");
  if (style.dim) parts.push("opacity-60");
  return parts.join(" ");
}

const ESC_SGR = /\x1b\[([0-9;]*)m/g;
// Strips all escape sequences, not just SGR.
const ESC_ANY = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ESC_ANY, "");
}

export function parseAnsi(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let style: Style = {};
  let lastIndex = 0;

  ESC_SGR.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ESC_SGR.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      const cls = styleToClass(style);
      nodes.push(
        cls
          ? React.createElement("span", { className: cls, key: lastIndex }, before)
          : before,
      );
    }
    const raw = match[1];
    const codes = raw === "" ? [0] : raw.split(";").map(Number);
    for (const c of codes) {
      style = applyCode(style, c);
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    const cls = styleToClass(style);
    nodes.push(
      cls
        ? React.createElement("span", { className: cls, key: lastIndex }, tail)
        : tail,
    );
  }

  return nodes;
}
