import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type OverlayFrameSize = "full" | "lg";

interface OverlayFrameProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: OverlayFrameSize;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "video[controls]",
  "audio[controls]",
  "iframe",
  "summary",
  "[tabindex]",
  "[contenteditable]",
].join(",");

// Explicit negative tabindex (e.g. roving tab controls) is not tabbable.
function hasNegativeTabIndex(el: Element): boolean {
  const raw = el.getAttribute("tabindex");
  if (raw === null) return false;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value < 0;
}

// Tabbable elements inside the dialog, in DOM order. Layout-based visibility is
// intentionally skipped so behavior is deterministic; `hidden` subtrees (used by
// the RunModal tab panels) and negative tabindex are excluded.
function getFocusable(root: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (el.hasAttribute("disabled")) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (hasNegativeTabIndex(el)) continue;
    if (el.closest("[hidden]") !== null) continue;
    result.push(el);
  }
  return result;
}

const DIALOG_SIZE_CLASSES: Record<OverlayFrameSize, string> = {
  full: "h-full w-full rounded-none",
  lg: "h-[96dvh] w-[96vw] rounded-2xl",
};

// `full` insets from device notches via the safe-area env() values; `lg` keeps
// the previous comfortable gutter.
const WRAPPER_PADDING_CLASSES: Record<OverlayFrameSize, string> = {
  full:
    "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
  lg: "p-4",
};

export function OverlayFrame({
  title,
  onClose,
  children,
  size = "full",
}: OverlayFrameProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  const [container] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.setAttribute("data-overlay-frame-root", "");
    return el;
  });

  useEffect(() => {
    if (container === null) return;
    const body = document.body;
    body.appendChild(container);

    // Capture focus before making anything inert, because setting `inert` on an
    // ancestor of the active element blurs it in real browsers.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Make every other top-level body child inert, remembering which ones
    // already carried the attribute so cleanup restores the exact prior state.
    const priorInert: { el: HTMLElement; had: boolean }[] = [];
    for (const child of Array.from(body.children)) {
      if (child === container) continue;
      if (!(child instanceof HTMLElement)) continue;
      priorInert.push({ el: child, had: child.hasAttribute("inert") });
      child.setAttribute("inert", "");
    }

    const priorOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    // Move focus into the dialog once its content is committed.
    const dialog = dialogRef.current;
    if (dialog !== null) {
      const focusable = getFocusable(dialog);
      const target = focusable[0] ?? dialog;
      target.focus();
    }

    return () => {
      for (const { el, had } of priorInert) {
        if (!had) el.removeAttribute("inert");
      }
      body.style.overflow = priorOverflow;
      if (container.parentNode !== null) {
        container.parentNode.removeChild(container);
      }
      if (previouslyFocused !== null && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [container]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (dialog === null) return;

    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    // Active element sits inside the dialog but is not a live focusable entry
    // (e.g. excluded by hidden/aria-hidden/negative tabindex). Treat it like an
    // edge of the list so Tab still wraps deterministically.
    const excludedInside =
      dialog.contains(active) && !focusable.includes(active as HTMLElement);

    if (event.shiftKey) {
      if (active === first || excludedInside || !dialog.contains(active)) {
        event.preventDefault();
        last?.focus();
      }
    } else if (active === last || excludedInside || !dialog.contains(active)) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (container === null) return null;

  return createPortal(
    <div
      className={[
        "fixed inset-0 z-[60] flex items-center justify-center",
        WRAPPER_PADDING_CLASSES[size],
      ].join(" ")}
    >
      {/* Scrim: pointer-only dismiss target, deliberately not focusable. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={[
          "relative flex flex-col overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl outline-none",
          DIALOG_SIZE_CLASSES[size],
        ].join(" ")}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
          <h2
            id={titleId}
            className="truncate text-lg font-semibold text-zinc-50"
          >
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden px-6 py-5">{children}</div>
      </div>
    </div>,
    container,
  );
}
