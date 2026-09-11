/**
 * Labeled target-host domain field. FilterBar label/input tokens; read-only
 * when onChange is omitted.
 */
import React from "react";

export interface DomainFieldProps {
  label?: string;
  value: string;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  helperText?: string;
  helperId?: string;
  previewId?: string;
  autoComplete?: string;
  onChange?: (value: string) => void;
}

function joinDescribedBy(ids: Array<string | undefined>): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined && id !== "");
  return present.length === 0 ? undefined : present.join(" ");
}

const DomainField = React.forwardRef<HTMLInputElement, DomainFieldProps>(
  function DomainField(
    {
      label = "Server address",
      value,
      id = "validator-domain",
      name,
      placeholder,
      disabled = false,
      readOnly,
      error,
      helperText,
      helperId,
      previewId,
      autoComplete = "off",
      onChange,
    },
    ref,
  ): React.ReactElement {
    const isReadOnly = readOnly === true || onChange === undefined;
    const hasError = error !== undefined && error !== "";
    const hasHelper = helperText !== undefined && helperText !== "";
    const resolvedHelperId = hasHelper ? (helperId ?? `${id}-help`) : undefined;
    const errorId = hasError ? `${id}-error` : undefined;
    const describedBy = joinDescribedBy([resolvedHelperId, previewId, errorId]);

    return (
      <label className="space-y-1" htmlFor={id}>
        <div className="text-xs font-semibold text-zinc-400">{label}</div>
        <input
          id={id}
          name={name}
          ref={ref}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={isReadOnly}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600"
          onChange={
            onChange === undefined ? undefined : (event) => onChange(event.target.value)
          }
        />
        {hasHelper && resolvedHelperId !== undefined ? (
          <p id={resolvedHelperId} className="text-xs text-zinc-500">
            {helperText}
          </p>
        ) : null}
        {hasError ? (
          <p id={errorId} className="text-xs text-rose-200" role="alert">
            {error}
          </p>
        ) : null}
      </label>
    );
  },
);

export default DomainField;
