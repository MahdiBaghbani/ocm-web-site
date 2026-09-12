import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import ReportJsonModal from "./ReportJsonModal";

const REPORT = {
  schema: "federation_tester_report.v1",
  id: "abc",
  marker: "REPORTMARKER",
};
const NOTE = "This is the last live session snapshot.";

interface DomRegistrator {
  register: (options?: { url?: string }) => void;
  unregister: () => void;
}

function isDomRegistrator(value: unknown): value is DomRegistrator {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  if (!("register" in value) || typeof value.register !== "function") return false;
  if (!("unregister" in value) || typeof value.unregister !== "function") return false;
  return true;
}

let registrator: DomRegistrator | null = null;
let root: Root | null = null;

beforeAll(async () => {
  const specifier: string = "@happy-dom/global-registrator";
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch (cause) {
    throw new Error(
      "ReportJsonModal.test.tsx needs a DOM environment. Install the dev-only " +
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
    throw new Error("happy-dom is installed but did not expose a GlobalRegistrator export.");
  }
  registrator = mod.GlobalRegistrator;
  registrator.register({ url: "http://localhost/" });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterAll(() => {
  registrator?.unregister();
});

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
});

function mount(ui: ReactElement): void {
  act(() => {
    root = createRoot(document.body);
    root.render(ui);
  });
}

function noteParagraphs(): HTMLParagraphElement[] {
  return Array.from(document.querySelectorAll("p")).filter(
    (el) => el.textContent === NOTE,
  );
}

function mustCloseButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll("button"));
  const close = buttons.find((el) => el.textContent === "Close");
  if (close === undefined) throw new Error("Close button not found");
  return close;
}

describe("ReportJsonModal note and source report", () => {
  test("renders a note paragraph when note is supplied", () => {
    mount(
      <ReportJsonModal
        title="Raw report JSON"
        sourceReport={REPORT}
        onClose={() => undefined}
        downloadName="report-abc.json"
        note={NOTE}
      />,
    );
    expect(noteParagraphs().length).toBe(1);
    expect(document.body.textContent).toContain(NOTE);
  });

  test("omits the note paragraph when note is null", () => {
    mount(
      <ReportJsonModal
        title="Raw report JSON"
        sourceReport={REPORT}
        onClose={() => undefined}
        downloadName="report-abc.json"
        note={null}
      />,
    );
    expect(noteParagraphs().length).toBe(0);
    expect(document.querySelectorAll("p").length).toBe(0);
    expect(document.body.textContent).not.toContain(NOTE);
  });

  test("RawJsonPanel contains the source report", () => {
    mount(
      <ReportJsonModal
        title="Raw report JSON"
        sourceReport={REPORT}
        onClose={() => undefined}
        downloadName="report-abc.json"
      />,
    );
    expect(document.body.textContent).toContain("REPORTMARKER");
    expect(document.body.textContent).toContain("federation_tester_report.v1");
    expect(document.querySelector('[data-testid="file-viewer-chip"]')).not.toBeNull();
    const titles = Array.from(document.querySelectorAll("h2, h3")).filter(
      (el) => el.textContent === "Raw report JSON",
    );
    expect(titles.length).toBe(1);
    expect(titles[0]?.tagName).toBe("H2");
  });
});

describe("ReportJsonModal close", () => {
  test("Close button calls onClose", () => {
    let closed = 0;
    mount(
      <ReportJsonModal
        title="Raw report JSON"
        sourceReport={REPORT}
        onClose={() => {
          closed += 1;
        }}
        downloadName="report-abc.json"
      />,
    );

    const close = mustCloseButton();
    act(() => {
      close.click();
    });
    expect(closed).toBe(1);
  });
});
