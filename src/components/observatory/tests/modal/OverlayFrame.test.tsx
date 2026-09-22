// Behavior tests for OverlayFrame. The repo has no prior test harness, so this
// file bootstraps a DOM via happy-dom's global registrator. happy-dom is loaded
// through a runtime-only specifier so the suite fails with a clear, actionable
// message if the DOM harness is not installed rather than a cryptic resolver
// error.
import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OverlayFrame, type OverlayFrameSize } from "@/components/observatory/modal/OverlayFrame";

interface DomRegistrator {
  register: (options?: { url?: string }) => void;
  unregister: () => Promise<void>;
}

function isDomRegistrator(value: unknown): value is DomRegistrator {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  if (!("register" in value) || typeof value.register !== "function") {
    return false;
  }
  if (!("unregister" in value) || typeof value.unregister !== "function") {
    return false;
  }
  return true;
}

let registrator: DomRegistrator | null = null;
let priorActEnvironmentPresent = false;
let priorActEnvironment: unknown = undefined;

beforeAll(async () => {
  // Runtime-only specifier: keeps the type checker from requiring the optional
  // dev dependency and lets us surface a helpful error when it is missing.
  const specifier: string = "@happy-dom/global-registrator";
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch (cause) {
    throw new Error(
      "OverlayFrame.test.tsx needs a DOM environment. Install the dev-only " +
        "harness with `bun add -d happy-dom @happy-dom/global-registrator` " +
        "and re-run `bun test`.",
      { cause },
    );
  }
  if (
    typeof mod !== "object" ||
    mod === null ||
    !("GlobalRegistrator" in mod) ||
    !isDomRegistrator(mod.GlobalRegistrator)
  ) {
    throw new Error(
      "happy-dom is installed but did not expose a GlobalRegistrator export.",
    );
  }
  registrator = mod.GlobalRegistrator;
  priorActEnvironmentPresent = Reflect.has(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  priorActEnvironment = priorActEnvironmentPresent
    ? Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
    : undefined;
  registrator.register({ url: "http://localhost/" });
  // React 19 requires this flag for act() outside a bundler test preset.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(async () => {
  if (registrator === null) {
    return;
  }
  const current = registrator;
  await current.unregister();
  registrator = null;
  if (priorActEnvironmentPresent) {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorActEnvironment);
  } else {
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

let root: Root | null = null;

function mount(ui: ReactElement): void {
  act(() => {
    root = createRoot(document.body);
    root.render(ui);
  });
}

function rerender(ui: ReactElement): void {
  act(() => {
    root?.render(ui);
  });
}

afterEach(() => {
  if (root !== null) {
    const current = root;
    act(() => {
      current.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  mock.restore();
});

// Query helper that fails loudly instead of returning null (avoids casts).
function must<T extends HTMLElement = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`Element not found: ${selector}`);
  return el;
}

function overlayRoot(): HTMLElement {
  return must("[data-overlay-frame-root]");
}

function dialog(): HTMLElement {
  return must('[role="dialog"]');
}

function scrim(): HTMLElement {
  return must('[aria-hidden="true"]', overlayRoot());
}

function fireKeyDown(target: EventTarget, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

interface HarnessProps {
  open: boolean;
  size?: OverlayFrameSize;
  onClose: () => void;
}

function OverlayHarness({ open, size, onClose }: HarnessProps): ReactElement {
  return (
    <div>
      <button type="button" data-testid="trigger">
        trigger
      </button>
      {open ? (
        <OverlayFrame title="Test Modal" onClose={onClose} size={size}>
          <button type="button" data-testid="a">
            A
          </button>
          <button type="button" data-testid="b">
            B
          </button>
        </OverlayFrame>
      ) : null}
    </div>
  );
}

describe("OverlayFrame", () => {
  test("portals its content to document.body", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const root = overlayRoot();
    expect(root.parentElement).toBe(document.body);
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  });

  test("marks the dialog with modal a11y attributes", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const el = dialog();
    expect(el.getAttribute("aria-modal")).toBe("true");
    const labelledby = el.getAttribute("aria-labelledby");
    expect(labelledby).not.toBeNull();
    if (labelledby !== null) {
      // useId() ids contain colons, so resolve by id rather than a CSS selector.
      const label = document.getElementById(labelledby);
      expect(label).not.toBeNull();
      expect(label?.textContent).toBe("Test Modal");
    }
  });

  test("makes other top-level body children inert and restores them", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open={false} onClose={onClose} size="lg" />);
    const trigger = must('[data-testid="trigger"]');
    // Parent of the trigger is a direct body child that should become inert.
    const background = trigger.parentElement;
    expect(background).not.toBeNull();
    if (background === null) throw new Error("no background element");
    expect(background.hasAttribute("inert")).toBe(false);

    rerender(<OverlayHarness open onClose={onClose} size="lg" />);
    expect(background.hasAttribute("inert")).toBe(true);
    expect(overlayRoot().hasAttribute("inert")).toBe(false);

    rerender(<OverlayHarness open={false} onClose={onClose} size="lg" />);
    expect(background.hasAttribute("inert")).toBe(false);
  });

  test("locks and restores body scroll", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open={false} onClose={onClose} size="lg" />);
    expect(document.body.style.overflow).toBe("");

    rerender(<OverlayHarness open onClose={onClose} size="lg" />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<OverlayHarness open={false} onClose={onClose} size="lg" />);
    expect(document.body.style.overflow).toBe("");
  });

  test("moves initial focus into the dialog", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);
    const active = document.activeElement;
    expect(active).not.toBeNull();
    expect(dialog().contains(active)).toBe(true);
  });

  test("wraps focus to the first element when Tab is pressed on the last", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const first = must('button[type="button"]', dialog()); // the Close button
    const last = must('[data-testid="b"]');
    last.focus();
    expect(document.activeElement).toBe(last);

    fireKeyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  test("wraps focus to the last element when Shift+Tab is pressed on the first", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const first = must('button[type="button"]', dialog());
    const last = must('[data-testid="b"]');
    first.focus();
    expect(document.activeElement).toBe(first);

    fireKeyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("excludes focusable elements inside a [hidden] subtree from the focus trap", () => {
    const onClose = mock(() => {});
    mount(
      <OverlayFrame title="Test Modal" onClose={onClose} size="lg">
        <button type="button" data-testid="visible-a">
          A
        </button>
        <button type="button" data-testid="visible-b">
          B
        </button>
        <div hidden>
          <button type="button" data-testid="hidden">
            Hidden
          </button>
        </div>
      </OverlayFrame>,
    );

    const first = must('button[type="button"]', dialog()); // the Close button
    const lastVisible = must('[data-testid="visible-b"]');
    const hidden = must('[data-testid="hidden"]');

    // The hidden button sits last in DOM order. If the trap treated it as
    // focusable, Tab on the last visible button would not wrap to the first.
    lastVisible.focus();
    expect(document.activeElement).toBe(lastVisible);

    fireKeyDown(lastVisible, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(hidden);
  });

  test("excludes elements with a negative tabindex from the tab order", () => {
    const onClose = mock(() => {});
    mount(
      <OverlayFrame title="Test Modal" onClose={onClose} size="lg">
        <button type="button" data-testid="visible-a">
          A
        </button>
        <button type="button" data-testid="visible-b">
          B
        </button>
        <button type="button" tabIndex={-1} data-testid="skip">
          Skip
        </button>
      </OverlayFrame>,
    );

    const first = must('button[type="button"]', dialog()); // the Close button
    const lastVisible = must('[data-testid="visible-b"]');
    const skip = must('[data-testid="skip"]');

    // The tabindex=-1 button sits last in DOM order. If it were part of the tab
    // order, Tab on the last real element would not wrap to the first.
    lastVisible.focus();
    expect(document.activeElement).toBe(lastVisible);

    fireKeyDown(lastVisible, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(skip);
  });

  test("wraps focus when Tab fires from an excluded-inside element", () => {
    const onClose = mock(() => {});
    mount(
      <OverlayFrame title="Test Modal" onClose={onClose} size="lg">
        <button type="button" data-testid="visible-a">
          A
        </button>
        <button type="button" tabIndex={-1} data-testid="excluded">
          Excluded
        </button>
        <button type="button" data-testid="visible-b">
          B
        </button>
      </OverlayFrame>,
    );

    const first = must('button[type="button"]', dialog()); // the Close button
    const lastVisible = must('[data-testid="visible-b"]');
    const excluded = must('[data-testid="excluded"]');

    // The excluded button is inside the dialog but absent from the live
    // focusable list (negative tabindex), and it is neither the first nor the
    // last focusable entry. Focusing it directly drives the `excludedInside`
    // branch specifically: without that branch, active !== first and
    // active !== last, so Tab would not preventDefault or wrap at all and focus
    // would stay put. This is stronger than an ordinary first/last wrap.
    excluded.focus();
    expect(document.activeElement).toBe(excluded);
    expect(excluded).not.toBe(first);
    expect(excluded).not.toBe(lastVisible);

    fireKeyDown(excluded, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    excluded.focus();
    expect(document.activeElement).toBe(excluded);

    fireKeyDown(excluded, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastVisible);
  });

  test("closes on Escape", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    fireKeyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closes when the scrim is clicked", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    act(() => {
      scrim().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("keeps the scrim out of the tab order", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const el = scrim();
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  test("restores focus to the previously focused element on close", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open={false} onClose={onClose} size="lg" />);

    const trigger = must('[data-testid="trigger"]');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<OverlayHarness open onClose={onClose} size="lg" />);
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog().contains(document.activeElement)).toBe(true);

    rerender(<OverlayHarness open={false} onClose={onClose} size="lg" />);
    expect(document.activeElement).toBe(trigger);
  });

  test("applies lg size classes and gutter padding", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="lg" />);

    const panel = dialog();
    expect(panel.className).toContain("h-[96dvh]");
    expect(panel.className).toContain("w-[96vw]");

    const wrapper = panel.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("z-[60]");
    expect(wrapper?.className).toContain("p-4");
  });

  test("applies full size classes with safe-area padding", () => {
    const onClose = mock(() => {});
    mount(<OverlayHarness open onClose={onClose} size="full" />);

    const panel = dialog();
    expect(panel.className).toContain("h-full");
    expect(panel.className).toContain("w-full");

    const wrapper = panel.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("z-[60]");
    expect(wrapper?.className).toContain("pt-[env(safe-area-inset-top)]");
  });
});

describe("RunModal", () => {
  test("passes the lg size to OverlayFrame", async () => {
    let capturedSize: unknown;
    mock.module("@/components/observatory/modal/OverlayFrame", () => ({
      OverlayFrame: (props: { size?: unknown }) => {
        capturedSize = props.size;
        return null;
      },
    }));

    const { RunModal } = await import("@/components/observatory/modal/RunModal");

    const onClose = mock(() => {});
    const onSelectRun = mock(() => {});
    mount(
      <RunModal
        cellId=""
        runId=""
        mf={null}
        baseUrl="http://localhost/"
        flows={[]}
        platformLabel={(id) => id}
        onClose={onClose}
        onSelectRun={onSelectRun}
      />,
    );

    expect(capturedSize).toBe("lg");
  });
});
