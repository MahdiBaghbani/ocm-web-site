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
  onChange?: (value: string) => void;
}

export default function DomainField({
  label = "Domain",
  value,
  id = "validator-domain",
  name,
  placeholder,
  disabled = false,
  readOnly,
  error,
  onChange,
}: DomainFieldProps): React.ReactElement {
  const isReadOnly = readOnly === true || onChange === undefined;
  const describedBy = error !== undefined && error !== "" ? `${id}-error` : undefined;

  return (
    <label className="space-y-1" htmlFor={id}>
      <div className="text-xs font-semibold text-zinc-400">{label}</div>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={isReadOnly}
        aria-invalid={describedBy !== undefined}
        aria-describedby={describedBy}
        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600"
        onChange={
          onChange === undefined ? undefined : (event) => onChange(event.target.value)
        }
      />
      {describedBy !== undefined ? (
        <p id={describedBy} className="text-xs text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}
