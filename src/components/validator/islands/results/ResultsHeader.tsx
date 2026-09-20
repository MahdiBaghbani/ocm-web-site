/**
 * Session-start and identity header slots for the RESULTS island.
 * Handlers and session identity stay in ResultsShell.
 */
import React from "react";
import type { PageLinkAction } from "../../lib/results/actionRows";
import {
  SESSION_START_LOADING_TEXT,
  type SessionStartProjection,
} from "../../lib/results/sessionStart";

export const PAGE_LINK_NOT_SAVED_NOTICE =
  "Not saved. This result was not stored as a public report. A copied page link identifies the session but does not preserve these scores or evidence.";

const ACTION_BTN =
  "inline-flex min-h-11 items-center rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800";

export type ResultsHeaderProps =
  | {
      kind: "session-start";
      sessionStart: SessionStartProjection;
      testHref: string;
    }
  | {
      kind: "identity";
      host: string;
      sessionId: string;
      pageLink: PageLinkAction;
      onCopyPageLink: () => void;
    };

function BackToTest({ href }: { href: string }): React.ReactElement {
  return (
    <a href={href} className={`${ACTION_BTN} text-zinc-200`}>
      Back to Test
    </a>
  );
}

export function ResultsHeader(props: ResultsHeaderProps): React.ReactElement {
  if (props.kind === "session-start") {
    if (props.sessionStart.kind === "failure") {
      return (
        <div className="space-y-4">
          <BackToTest href={props.testHref} />
          <p className="text-sm text-rose-200" role="alert">
            {props.sessionStart.message}
          </p>
        </div>
      );
    }
    return <p className="text-sm text-zinc-400">{SESSION_START_LOADING_TEXT}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-100">
          Result for {props.host}
        </p>
        <p className="mt-1 break-all text-sm text-zinc-400">
          Session {props.sessionId}
        </p>
        {props.pageLink.visible ? (
          <>
            <button
              type="button"
              className={`${ACTION_BTN} mt-2`}
              onClick={() => {
                props.onCopyPageLink();
              }}
            >
              {props.pageLink.label}
            </button>
            {props.pageLink.showNotSavedNotice ? (
              <p className="mt-2 text-sm text-zinc-400">
                {PAGE_LINK_NOT_SAVED_NOTICE}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
