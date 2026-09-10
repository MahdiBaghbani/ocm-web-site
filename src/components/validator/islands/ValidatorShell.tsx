/**
 * SCAN island. Loads config and manifest, starts a session, then navigates
 * with only host and id.
 */
import React, { useEffect, useRef, useState } from "react";
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
import { interpretHostInput, serializeValidatorUrlState } from "../lib/urlState";
import { isRecord } from "../lib/validatorShared";

const DEFAULT_RESULTS_HREF = "/validator/results";
const HOST_PREVIEW_ID = "validator-host-preview";

export const ENTRY_HEADING = "Check a server";
export const ENTRY_INSTRUCTION = "Enter the server you want to check.";
export const ENTRY_LEGEND = "Optional settings";
export const ENTRY_SUBMIT_LABEL = "Check this server";
export const ENTRY_LOADING_VALIDATOR = "Loading validator...";
export const ENTRY_LOADING_OPTION = "Loading option...";
export const ENTRY_STARTING = "Starting check...";
export const ENTRY_MANIFEST_UNAVAILABLE =
  "Extra scan options are unavailable. You can still run a basic check.";

export interface ValidatorShellProps {
  resultsHref?: string;
}

export interface ValidatorEntryFormProps {
  target: string;
  onTargetChange: (value: string) => void;
  optInPermanent: boolean;
  optInActive: boolean;
  optInStats: boolean;
  onOptInPermanentChange: (value: boolean) => void;
  onOptInActiveChange: (value: boolean) => void;
  onOptInStatsChange: (value: boolean) => void;
  submitting: boolean;
  configReady: boolean;
  activeAvailable: boolean;
  manifestLoading: boolean;
  manifestFailed: boolean;
  hostError: string;
  formError: string;
  previewHost: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
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

function OptInRow({
  id,
  label,
  hint,
  checked,
  disabled,
  statusText,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  statusText?: string;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <label
      className={`flex min-h-11 items-start gap-3 rounded-xl px-1 py-2 text-sm ${
        disabled === true ? "cursor-not-allowed text-zinc-500" : "cursor-pointer text-zinc-200"
      }`}
      htmlFor={id}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        className="mt-1 rounded border-zinc-700 bg-zinc-950/40"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-zinc-200">{label}</span>
        <span className="text-zinc-500">{hint}</span>
        {statusText !== undefined && statusText !== "" ? (
          <span className="text-zinc-400">{statusText}</span>
        ) : null}
      </span>
    </label>
  );
}

export function ValidatorEntryForm({
  target,
  onTargetChange,
  optInPermanent,
  optInActive,
  optInStats,
  onOptInPermanentChange,
  onOptInActiveChange,
  onOptInStatsChange,
  submitting,
  configReady,
  activeAvailable,
  manifestLoading,
  manifestFailed,
  hostError,
  formError,
  previewHost,
  onSubmit,
  inputRef,
}: ValidatorEntryFormProps): React.ReactElement {
  const activeDisabled = submitting || !activeAvailable;
  const submitLabel = submitting
    ? ENTRY_STARTING
    : configReady
      ? ENTRY_SUBMIT_LABEL
      : ENTRY_LOADING_VALIDATOR;
  const activeStatus = manifestLoading ? ENTRY_LOADING_OPTION : undefined;

  return (
    <form
      className="flex flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-6"
      onSubmit={onSubmit}
    >
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-zinc-100">{ENTRY_HEADING}</h2>
        <p className="text-sm text-zinc-400">{ENTRY_INSTRUCTION}</p>
      </div>
      <DomainField
        ref={inputRef}
        value={target}
        placeholder="peer.example.com"
        disabled={submitting}
        error={hostError === "" ? undefined : hostError}
        previewId={previewHost === null ? undefined : HOST_PREVIEW_ID}
        onChange={onTargetChange}
      />
      {previewHost !== null ? (
        <p id={HOST_PREVIEW_ID} className="text-sm text-zinc-400">
          Server to check: {previewHost}
        </p>
      ) : null}
      <fieldset className="space-y-1 border-0 p-0">
        <legend className="px-1 text-xs font-semibold text-zinc-400">{ENTRY_LEGEND}</legend>
        <OptInRow
          id="validator-opt-in-permanent"
          label="Save a public report"
          hint="Anyone with the link can view it. The retention policy applies."
          checked={optInPermanent}
          disabled={submitting}
          onChange={onOptInPermanentChange}
        />
        <OptInRow
          id="validator-opt-in-active"
          label="Run active validation"
          hint="Tests live sharing steps and may ask you to complete actions."
          checked={optInActive}
          disabled={activeDisabled}
          statusText={activeStatus}
          onChange={onOptInActiveChange}
        />
        <OptInRow
          id="validator-opt-in-stats"
          label="Contribute to public statistics"
          hint="Adds aggregate data after privacy thresholds. No public server report."
          checked={optInStats}
          disabled={submitting}
          onChange={onOptInStatsChange}
        />
      </fieldset>
      {manifestFailed ? (
        <p className="text-sm text-zinc-400">{ENTRY_MANIFEST_UNAVAILABLE}</p>
      ) : null}
      {formError !== "" ? (
        <p className="text-sm text-rose-200" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="border-t border-zinc-800 pt-3">
        <button
          type="submit"
          disabled={submitting || !configReady}
          className="min-h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function ValidatorShell({
  resultsHref = DEFAULT_RESULTS_HREF,
}: ValidatorShellProps): React.ReactElement {
  const [config, setConfig] = useState<ValidatorRuntimeConfig | null>(null);
  const [manifest, setManifest] = useState<ValidatorManifest | null>(null);
  const [manifestFailed, setManifestFailed] = useState(false);
  const [target, setTarget] = useState("");
  const [optInActive, setOptInActive] = useState(false);
  const [optInStats, setOptInStats] = useState(false);
  const [optInPermanent, setOptInPermanent] = useState(false);
  const [hostError, setHostError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canUseActive = activeOptInAvailable(manifest);
  const interpreted = interpretHostInput(target);
  const previewHost = interpreted.ok ? interpreted.host : null;
  const manifestLoading = config !== null && manifest === null && !manifestFailed;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const loaded = await loadValidatorConfig(fetchConfigSource(fetch.bind(globalThis)));
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
        setManifestFailed(true);
      }
    })();
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (config === null || submitting) {
      return;
    }
    const hostResult = interpretHostInput(target);
    if (!hostResult.ok) {
      setHostError(hostResult.message);
      setFormError("");
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setHostError("");
    setFormError("");
    const result = await startSession({
      target: `https://${hostResult.host}`,
      optInStats,
      optInPermanent,
      ...(canUseActive ? { optInActive } : {}),
    }, requestDeps(config));
    if (!result.ok) {
      setSubmitting(false);
      if (result.message.trim() !== "") {
        setFormError(result.message);
      }
      return;
    }
    const serialized = serializeValidatorUrlState(
      { host: hostResult.host, id: result.data.id },
      { base: resultsHref },
    );
    if (!serialized.ok) {
      setSubmitting(false);
      setFormError("Could not build the results URL");
      return;
    }
    window.location.assign(serialized.href);
  }

  return (
    <ValidatorEntryForm
      target={target}
      onTargetChange={(value) => {
        setTarget(value);
        if (hostError !== "") {
          setHostError("");
        }
      }}
      optInPermanent={optInPermanent}
      optInActive={optInActive}
      optInStats={optInStats}
      onOptInPermanentChange={setOptInPermanent}
      onOptInActiveChange={setOptInActive}
      onOptInStatsChange={setOptInStats}
      submitting={submitting}
      configReady={config !== null}
      activeAvailable={canUseActive}
      manifestLoading={config === null || manifestLoading}
      manifestFailed={manifestFailed}
      hostError={hostError}
      formError={formError}
      previewHost={previewHost}
      inputRef={inputRef}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    />
  );
}
