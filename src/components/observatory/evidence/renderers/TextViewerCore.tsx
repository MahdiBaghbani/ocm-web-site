import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseAnsi, stripAnsi } from "./ansi";

export interface TextViewerCoreProps {
  content: string;
  language: "json" | "yaml" | "env" | "log" | "plain";
  followTail?: boolean;
  truncated?: boolean;
  truncationNote?: string;
  className?: string;
}

interface LineMatch {
  lineIdx: number;
  start: number;
  end: number;
  globalIdx: number;
}

// Single-pass JSON tokenizer: keys ("k":), string values, booleans/null, numbers.
const JSON_RE =
  /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(true|false|null)|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function colorizeJson(line: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  JSON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_RE.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls =
      m[1] !== undefined
        ? "text-sky-300"
        : m[2] !== undefined
          ? "text-emerald-300"
          : m[3] !== undefined
            ? "text-fuchsia-300"
            : "text-amber-300";
    out.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return <>{out}</>;
}

export default function TextViewerCore({
  content,
  language,
  followTail = false,
  truncated,
  truncationNote,
  className,
}: TextViewerCoreProps) {
  const [search, setSearch] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(followTail);
  const [ansiOn, setAnsiOn] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);

  const displayText = useMemo(
    () => (language === "log" && !ansiOn ? stripAnsi(content) : content),
    [content, language, ansiOn],
  );

  const lines = useMemo(() => displayText.split("\n"), [displayText]);

  const lineMatches = useMemo<LineMatch[]>(() => {
    if (!search) return [];
    const needle = search.toLowerCase();
    const out: LineMatch[] = [];
    lines.forEach((line, lineIdx) => {
      const lc = line.toLowerCase();
      let pos = 0;
      while (pos < line.length) {
        const found = lc.indexOf(needle, pos);
        if (found === -1) break;
        out.push({ lineIdx, start: found, end: found + needle.length, globalIdx: out.length });
        pos = found + needle.length;
      }
    });
    return out;
  }, [search, lines]);

  const totalMatches = lineMatches.length;

  useEffect(() => {
    setMatchIdx(0);
    matchRefs.current = [];
  }, [search]);

  useEffect(() => {
    matchRefs.current[matchIdx]?.scrollIntoView({ block: "nearest" });
  }, [matchIdx]);

  // Scroll to bottom when follow-tail is enabled and content grows.
  useEffect(() => {
    if (follow && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [follow, content.length]);

  const matchesByLine = useMemo(() => {
    const map = new Map<number, LineMatch[]>();
    for (const lm of lineMatches) {
      const bucket = map.get(lm.lineIdx);
      if (bucket) bucket.push(lm);
      else map.set(lm.lineIdx, [lm]);
    }
    return map;
  }, [lineMatches]);

  const copyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore clipboard errors
    }
  }, [content]);

  function handleDownload() {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "content.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyLang(seg: string, key: string | number): React.ReactNode {
    if (language === "log" && ansiOn) return <span key={key}>{parseAnsi(seg)}</span>;
    if (language === "json") return <span key={key}>{colorizeJson(seg)}</span>;
    return <span key={key}>{seg}</span>;
  }

  function renderLine(line: string, lineIdx: number): React.ReactNode {
    const matches = matchesByLine.get(lineIdx);
    if (!matches?.length) {
      if (language === "log" && ansiOn) return parseAnsi(line);
      if (language === "json") return colorizeJson(line);
      return line;
    }
    const parts: React.ReactNode[] = [];
    let pos = 0;
    for (const m of matches) {
      if (m.start > pos) parts.push(applyLang(line.slice(pos, m.start), `pre-${m.globalIdx}`));
      const active = m.globalIdx === matchIdx;
      parts.push(
        <mark
          key={`m-${m.globalIdx}`}
          ref={(el) => {
            matchRefs.current[m.globalIdx] = el;
          }}
          className={active ? "bg-orange-400/70 text-zinc-900" : "bg-yellow-500/30 text-yellow-200"}
        >
          {line.slice(m.start, m.end)}
        </mark>,
      );
      pos = m.end;
    }
    if (pos < line.length) parts.push(applyLang(line.slice(pos), `tail-${lineIdx}`));
    return <>{parts}</>;
  }

  const btnCls =
    "rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800";
  const ckLabel = "flex cursor-pointer items-center gap-1 text-xs text-zinc-400";

  return (
    <div className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        {search && (
          <>
            <button type="button" className={btnCls} onClick={() => { if (totalMatches > 0) setMatchIdx((i) => (i - 1 + totalMatches) % totalMatches); }}>Prev</button>
            <span className="text-xs text-zinc-400">{totalMatches ? `${matchIdx + 1} / ${totalMatches}` : "0 / 0"}</span>
            <button type="button" className={btnCls} onClick={() => { if (totalMatches > 0) setMatchIdx((i) => (i + 1) % totalMatches); }}>Next</button>
          </>
        )}
        <label className={ckLabel}><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} className="accent-sky-500" />Wrap</label>
        {language === "log" && (
          <>
            <label className={ckLabel}><input type="checkbox" checked={ansiOn} onChange={(e) => setAnsiOn(e.target.checked)} className="accent-sky-500" />ANSI</label>
            <label className={ckLabel}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-sky-500" />Follow</label>
          </>
        )}
        <button type="button" className={btnCls} onClick={() => void copyContent()}>Copy</button>
        <button type="button" className={btnCls} onClick={handleDownload}>Download</button>
      </div>

      {truncated && (
        <div className="rounded bg-amber-900/50 px-3 py-2 text-xs text-amber-300">
          {truncationNote ?? "Output truncated"}
        </div>
      )}

      <div ref={bodyRef} className="max-h-[60vh] overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <div className={["font-mono text-xs", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"].join(" ")}>
          {lines.map((line, idx) => (
            <div key={idx} className="flex hover:bg-zinc-800/20">
              <span className="w-10 shrink-0 select-none border-r border-zinc-800 pr-3 text-right text-zinc-600">{idx + 1}</span>
              <span className="min-w-0 flex-1 pl-3 font-mono text-zinc-200">{renderLine(line, idx)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
