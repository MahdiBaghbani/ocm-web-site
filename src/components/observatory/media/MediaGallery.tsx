import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MediaItem {
  key: string;
  src: string;
  sources?: Array<{ srcset: string; type: string; media?: string }>;
  caption?: string;
  alt?: string;
}

type MediaGalleryUncontrolledProps = {
  items: MediaItem[];
  activeIndex?: undefined;
  onActiveChange?: undefined;
  emptyLabel?: string;
  onClose?: () => void;
};

type MediaGalleryControlledProps = {
  items: MediaItem[];
  activeIndex: number;
  onActiveChange: (i: number) => void;
  emptyLabel?: string;
  onClose?: () => void;
};

export type MediaGalleryProps =
  | MediaGalleryUncontrolledProps
  | MediaGalleryControlledProps;

const fsSupported =
  typeof document !== "undefined" && document.fullscreenEnabled === true;

function ThumbnailImg({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-16 w-24 bg-zinc-800 text-zinc-500 text-[10px] flex items-center justify-center">
        n/a
      </div>
    );
  }
  return (
    <img
      src={item.src}
      alt={item.alt ?? item.caption ?? ""}
      className="h-16 w-24 object-cover"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function MediaGallery(props: MediaGalleryProps) {
  const { items, emptyLabel, onClose } = props;
  // Narrow controlled vs uncontrolled from the discriminated union.
  const controlledIndex = props.activeIndex;
  const onActiveChange: ((i: number) => void) | undefined =
    props.activeIndex !== undefined ? props.onActiveChange : undefined;

  const [internalIndex, setInternalIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activeIndex = Math.min(
    controlledIndex !== undefined ? controlledIndex : internalIndex,
    Math.max(items.length - 1, 0),
  );

  const setActive = useCallback(
    (i: number) => {
      if (controlledIndex === undefined) {
        setInternalIndex(i);
      } else {
        onActiveChange?.(i);
      }
      setZoom(1);
    },
    [controlledIndex, onActiveChange],
  );

  // Auto-focus on mount.
  useEffect(() => {
    focusRef.current?.focus();
  }, []);

  // Reset zoom when controlled index changes.
  useEffect(() => {
    if (controlledIndex !== undefined) setZoom(1);
  }, [controlledIndex]);

  // Clamp internal index when items length shrinks.
  useEffect(() => {
    if (controlledIndex !== undefined || items.length === 0) return;
    setInternalIndex((current) => Math.min(current, items.length - 1));
  }, [controlledIndex, items.length]);

  // Track fullscreen state and restore focus on exit.
  useEffect(() => {
    function onFsChange() {
      const entering = document.fullscreenElement === wrapperRef.current;
      setIsFullscreen(entering);
      if (!entering) {
        wrapperRef.current?.focus();
      }
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  const activeItem = useMemo(
    () => items[activeIndex] ?? null,
    [items, activeIndex],
  );

  function prev() {
    setActive((activeIndex - 1 + items.length) % items.length);
  }

  function next() {
    setActive((activeIndex + 1) % items.length);
  }

  function toggleFullscreen() {
    if (!fsSupported) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      wrapperRef.current?.requestFullscreen().catch(() => undefined);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        prev();
        break;
      case "ArrowRight":
        e.preventDefault();
        next();
        break;
      case "+":
      case "=":
        e.preventDefault();
        setZoom((z) => Math.min(z + 0.25, 4));
        break;
      case "-":
        e.preventDefault();
        setZoom((z) => Math.max(z - 0.25, 0.25));
        break;
      case "0":
        e.preventDefault();
        setZoom(1);
        break;
      case "f":
      case "F":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "Escape":
        e.preventDefault();
        setZoom(1);
        onClose?.();
        break;
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 p-10">
        <span className="text-sm text-zinc-400">{emptyLabel ?? "No screenshots."}</span>
      </div>
    );
  }

  const fsTitle = !fsSupported
    ? "Fullscreen not supported"
    : isFullscreen
      ? "Exit fullscreen"
      : "Enter fullscreen";

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col gap-3 rounded-xl bg-zinc-950 p-3"
    >
      {/* Focusable wrapper for keyboard handling */}
      <div
        ref={focusRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="outline-none"
      >
        {/* Toolbar */}
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
            title="Zoom out"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
            title="Reset zoom"
            aria-label="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            title={fsTitle}
            aria-label="Toggle fullscreen"
            aria-pressed={isFullscreen}
            disabled={!fsSupported}
            aria-disabled={!fsSupported ? "true" : undefined}
          >
            full
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                onClose();
              }}
              className="ml-auto rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
              title="Close"
              aria-label="Close"
            >
              x
            </button>
          ) : null}
        </div>

        {/* Main image */}
        <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black">
          <div
            style={
              zoom !== 1
                ? { transform: `scale(${zoom})`, transformOrigin: "center" }
                : undefined
            }
          >
            {activeItem ? (
              failedKeys.has(activeItem.key) ? (
                <div className="border border-zinc-700 bg-zinc-900 text-zinc-500 text-sm flex items-center justify-center min-h-[40vh] rounded-xl w-full px-4">
                  Image failed to load
                </div>
              ) : activeItem.sources?.length ? (
                <picture>
                  {activeItem.sources.map((s, si) => (
                    <source
                      key={si}
                      srcSet={s.srcset}
                      type={s.type}
                      media={s.media}
                    />
                  ))}
                  <img
                    key={activeItem.key}
                    src={activeItem.src}
                    alt={activeItem.alt ?? activeItem.caption ?? ""}
                    className="max-h-[60vh] mx-auto rounded-xl bg-black object-contain"
                    loading="lazy"
                    decoding="async"
                    onError={() =>
                      setFailedKeys((prev) => new Set([...prev, activeItem.key]))
                    }
                  />
                </picture>
              ) : (
                <img
                  key={activeItem.key}
                  src={activeItem.src}
                  alt={activeItem.alt ?? activeItem.caption ?? ""}
                  className="max-h-[60vh] mx-auto rounded-xl bg-black object-contain"
                  loading="lazy"
                  decoding="async"
                  onError={() =>
                    setFailedKeys((prev) => new Set([...prev, activeItem.key]))
                  }
                />
              )
            ) : null}
          </div>
          {items.length > 1 ? (
            <>
              <button
                type="button"
                onClick={prev}
                title="Previous"
                aria-label="Previous screenshot"
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-black/50 text-lg text-zinc-100 backdrop-blur-sm transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                &lsaquo;
              </button>
              <button
                type="button"
                onClick={next}
                title="Next"
                aria-label="Next screenshot"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-black/50 text-lg text-zinc-100 backdrop-blur-sm transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                &rsaquo;
              </button>
            </>
          ) : null}
        </div>

        {/* Caption and position */}
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
          <span className="truncate">{activeItem?.caption ?? ""}</span>
          <span className="ml-2 shrink-0">
            {activeIndex + 1} / {items.length}
          </span>
        </div>

        {/* Thumbnail strip */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {items.map((item, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActive(i)}
                className={[
                  "shrink-0 overflow-hidden rounded-lg",
                  isActive ? "ring-2 ring-blue-500" : "ring-1 ring-zinc-700",
                ].join(" ")}
                title={item.caption ?? item.alt ?? String(i + 1)}
                aria-label={`Show screenshot ${i + 1}: ${item.caption ?? item.alt ?? item.key}`}
                aria-current={isActive ? "true" : undefined}
              >
                <ThumbnailImg item={item} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
