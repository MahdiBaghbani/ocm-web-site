/**
 * Page-link and report-link clipboard actions for the RESULTS island, plus the
 * copy-notice timer and unmount cleanup.
 */
import React, { useEffect, useRef, useState } from "react";
import type { ValidatorUrlState } from "../../lib/urlState";
import type { ResultsPageStatus } from "../../lib/results/projectResultsPage";
import {
  PAGE_LINK_READONLY_PARAM,
  PAGE_LINK_READONLY_VALUE,
} from "./constants";
import type { CopyNotice } from "./ProgressSection";

export const EMPTY_COPY_NOTICE: CopyNotice = { ok: true, text: "" };
export const COPY_SUCCESS_TEXT = "Copied";

export type ClipboardCopyTarget = {
  status: ResultsPageStatus;
  reportUrl: string | null;
};

function pageLinkHref(status: ResultsPageStatus, href: string): string {
  if (status !== "live") {
    return href;
  }
  try {
    const url = new URL(href);
    url.searchParams.set(PAGE_LINK_READONLY_PARAM, PAGE_LINK_READONLY_VALUE);
    return url.href;
  } catch {
    return href;
  }
}

function clipboardWriter(): Clipboard | undefined {
  if (
    typeof window === "undefined" ||
    window.isSecureContext !== true ||
    typeof navigator === "undefined"
  ) {
    return undefined;
  }
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    return undefined;
  }
  return clipboard;
}

function createOffscreenCopyTextarea(value: string): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  // 1px offscreen. display:none and the old opacity:0 fixed trick both break
  // selection in some browsers, so the node stays measurable for the copy.
  textarea.style.position = "absolute";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.overflow = "hidden";
  return textarea;
}

function restorePriorFocus(previousActive: Element | null, textarea: HTMLTextAreaElement): void {
  if (
    previousActive instanceof HTMLElement &&
    previousActive !== textarea &&
    previousActive.isConnected
  ) {
    try {
      previousActive.focus({ preventScroll: true });
    } catch {
      // Focus restore is best-effort.
    }
  }
}

// Shared page-link / report-link / later AG-1.4 copy helper. Tier 2 execCommand
// is best-effort only; a true return is not a guarantee on every browser.
export async function copyText(value: string): Promise<boolean> {
  const clipboard = clipboardWriter();
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Clipboard API rejected; try the execCommand fallback.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  const previousActive = document.activeElement;
  const textarea = createOffscreenCopyTextarea(value);
  document.body.appendChild(textarea);
  try {
    if (typeof textarea.focus === "function") {
      textarea.focus({ preventScroll: true });
    }
    if (typeof textarea.select === "function") {
      textarea.select();
    }
    if (typeof document.execCommand !== "function") {
      return false;
    }
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    try {
      const parent = textarea.parentNode;
      if (parent !== null) {
        parent.removeChild(textarea);
      }
    } catch {
      // Textarea cleanup is best-effort.
    }
    restorePriorFocus(previousActive, textarea);
  }
}

export function useClipboardActions({
  session,
  copyTargetRef,
}: {
  session: ValidatorUrlState | null;
  copyTargetRef: React.MutableRefObject<ClipboardCopyTarget>;
}): {
  copyNotice: CopyNotice;
  copyFallback: string | null;
  settleCopyOutcome: (ok: boolean, value: string, failureText: string) => void;
  handleCopyPageLink: () => Promise<void>;
  handleCopyReport: () => Promise<void>;
  reset: () => void;
} {
  const [copyNotice, setCopyNotice] = useState<CopyNotice>(EMPTY_COPY_NOTICE);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyMountedRef = useRef(true);

  function reset(): void {
    setCopyNotice(EMPTY_COPY_NOTICE);
    setCopyFallback(null);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }

  useEffect(() => {
    copyMountedRef.current = true;
    return () => {
      copyMountedRef.current = false;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  function clearCopyTimer(): void {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }

  function settleCopyOutcome(ok: boolean, value: string, failureText: string): void {
    clearCopyTimer();
    if (ok) {
      setCopyFallback(null);
      // Commit an empty live-region tick so a repeat copy can re-announce.
      setCopyNotice({ ok: true, text: "" });
      copyTimerRef.current = setTimeout(() => {
        if (!copyMountedRef.current) {
          copyTimerRef.current = null;
          return;
        }
        setCopyNotice({ ok: true, text: COPY_SUCCESS_TEXT });
        copyTimerRef.current = setTimeout(() => {
          if (!copyMountedRef.current) {
            copyTimerRef.current = null;
            return;
          }
          setCopyNotice((current) => (current.ok ? { ok: true, text: "" } : current));
          copyTimerRef.current = null;
        }, 2000);
      }, 0);
      return;
    }
    setCopyFallback(value);
    setCopyNotice({ ok: false, text: failureText });
  }

  async function handleCopyPageLink(): Promise<void> {
    if (session === null || typeof window === "undefined") {
      return;
    }
    const value = pageLinkHref(copyTargetRef.current.status, window.location.href);
    const ok = await copyText(value);
    settleCopyOutcome(ok, value, "Could not copy the page link.");
  }

  async function handleCopyReport(): Promise<void> {
    const reportUrl = copyTargetRef.current.reportUrl;
    if (reportUrl === null) {
      return;
    }
    const ok = await copyText(reportUrl);
    settleCopyOutcome(
      ok,
      reportUrl,
      "Could not copy the report link. Open the report and copy its address instead.",
    );
  }

  return {
    copyNotice,
    copyFallback,
    settleCopyOutcome,
    handleCopyPageLink,
    handleCopyReport,
    reset,
  };
}
