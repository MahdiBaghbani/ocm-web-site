/**
 * SCAN island. Loads config and manifest, starts a session, then navigates
 * with only host and id.
 */
import React, { useEffect, useState } from "react";
import DomainField from "../atoms/DomainField";
import {
  fetchConfigSource,
  loadValidatorConfig,
  type ValidatorRuntimeConfig,
} from "../lib/validatorConfig";
import {
  fetchManifest,
  startSession,
  type ValidatorFetchDeps,
  type ValidatorManifest,
} from "../lib/validatorFetch";
import { OPT_IN_MANIFEST_PATH } from "../lib/stateMachine";
import { normalizeHost, serializeValidatorUrlState } from "../lib/urlState";
import { isRecord } from "../lib/validatorShared";

const DEFAULT_RESULTS_HREF = "/validator/results";

export interface ValidatorShellProps {
  resultsHref?: string;
}

function valueAtPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function activeOptInAvailable(manifest: ValidatorManifest | null): boolean {
  if (manifest === null) {
    return false;
  }
  const field = valueAtPath(manifest, OPT_IN_MANIFEST_PATH);
  return field !== undefined && field !== null;
}

function requestDeps(
  config: ValidatorRuntimeConfig,
  signal?: AbortSignal,
): ValidatorFetchDeps {
  return {
    origin: config.validatorApiOrigin,
    timeoutMs: config.requestTimeoutMs,
    backoffInitialMs: config.backoffInitialMs,
    backoffMaxMs: config.backoffMaxMs,
    signal,
  };
}

function OptInCheck({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-200" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        className="rounded border-zinc-700 bg-zinc-950/40"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export default function ValidatorShell({
  resultsHref = DEFAULT_RESULTS_HREF,
}: ValidatorShellProps): React.ReactElement {
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [manifest, setManifest] = useState<ValidatorManifest | null>(null);
  const [target, setTarget] = useState("");
  const [optInActive, setOptInActive] = useState(false);
  const [optInStats, setOptInStats] = useState(false);
  const [optInPermanent, setOptInPermanent] = useState(false);
  const [error, setError] = useState("");
  const [manifestNote, setManifestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canUseActive = activeOptInAvailable(manifest);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch));
      if (controller.signal.aborted) {
        return;
      }
      setConfig(loaded);
      const result = await fetchManifest(requestDeps(loaded, controller.signal));
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        setManifest(result.data);
        return;
      }
      if (result.kind !== "aborted") {
        setManifestNote(result.message);
      }
    })();
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (config === null || submitting) {
      return;
    }
    const host = normalizeHost(target);
    if (host === null) {
      setError("Enter a valid host");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await startSession({
      target: host,
      optInStats,
      optInPermanent,
      ...(canUseActive ? { optInActive } : {}),
    }, requestDeps(config));
    if (!result.ok) {
      setSubmitting(false);
      setError(result.message);
      return;
    }
    const serialized = serializeValidatorUrlState(
      { host, id: result.data.id },
      { base: resultsHref },
    );
    if (!serialized.ok) {
      setSubmitting(false);
      setError("Could not build the results URL");
      return;
    }
    window.location.assign(serialized.href);
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-5"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <DomainField
          label="Target host"
          value={target}
          placeholder="peer.example.com"
          disabled={submitting}
          onChange={setTarget}
        />
        <div className="space-y-2">
          {canUseActive ? (
            <OptInCheck
              id="validator-opt-in-active"
              label="Active validation"
              checked={optInActive}
              disabled={submitting}
              onChange={setOptInActive}
            />
          ) : null}
          <OptInCheck
            id="validator-opt-in-stats"
            label="Contribute statistics"
            checked={optInStats}
            disabled={submitting}
            onChange={setOptInStats}
          />
          <OptInCheck
            id="validator-opt-in-permanent"
            label="Keep a permanent report"
            checked={optInPermanent}
            disabled={submitting}
            onChange={setOptInPermanent}
          />
        </div>
        {manifestNote !== "" ? (
          <p className="text-sm text-zinc-500">manifest unavailable: {manifestNote}</p>
        ) : null}
        {error !== "" ? (
          <p className="text-sm text-rose-200" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || config === null}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {submitting ? "Starting..." : "Start scan"}
        </button>
      </form>
    </div>
  );
}
