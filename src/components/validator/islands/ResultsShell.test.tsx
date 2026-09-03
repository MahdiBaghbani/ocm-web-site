import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ResultsShell from "./ResultsShell";

const SESSION_ID = "0193a0c2-7c1d-7b4a-8f2e-1a2b3c4d5e6f";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("ResultsShell hydration", () => {
  test("SSR without props matches the first client render and hides the missing-session alert", () => {
    const html = render(<ResultsShell />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
    expect(html).not.toContain('role="alert"');
  });

  test("SSR with host and id renders the session line without reading window location", () => {
    const html = render(<ResultsShell host="Peer.Example" id={` ${SESSION_ID} `} />);
    expect(html).toContain("peer.example / " + SESSION_ID);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
  });

  test("SSR with invalid props stays on the mounted-gate loading state", () => {
    const html = render(<ResultsShell host="not a host" id="has space" />);
    expect(html).toContain("Loading session...");
    expect(html).not.toContain("Missing host or session id");
  });
});
