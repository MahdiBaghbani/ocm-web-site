/**
 * Manifest summary: routes, retention, report paths, opt-in, availability.
 */
import React from "react";
import Pill from "../atoms/Pill";
import RawJsonPanel from "../atoms/RawJsonPanel";
import FieldRow from "../../observatory/stack/cards/FieldRow";
import SummaryCard from "../../observatory/ui/SummaryCard";
import type { ValidatorManifest, ValidatorOptInField } from "../lib/validatorManifest";

export interface ManifestCardProps {
  manifest: ValidatorManifest;
}

function flagLabel(available: boolean): string {
  return available ? "available" : "unavailable";
}

function optInFieldLabel(field: ValidatorOptInField | null | undefined): string {
  if (field === undefined || field === null) {
    return "unavailable";
  }
  return `type=${field.type} default=${field.default ? "true" : "false"}`;
}

function row(label: string, value: string): React.ReactElement {
  return <FieldRow label={label} fullValue={value} displayValue={value} />;
}

export default function ManifestCard({ manifest }: ManifestCardProps): React.ReactElement {
  const activeField = manifest.optIn.start.optInActive;
  const activeAvailable = activeField !== undefined && activeField !== null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard title="API" padding="sm">
          <div className="space-y-2">
            {row("schema", manifest.schema)}
            {row("api", manifest.apiVersion)}
            {row("prefix", manifest.servicePrefix)}
            {row("routes", String(manifest.routes.length))}
          </div>
        </SummaryCard>
        <SummaryCard title="Retention" padding="sm">
          <div className="space-y-2">
            {row("tiers", manifest.retention.tiers.join(", "))}
            {row("default", manifest.retention.defaultTier)}
            {row("clock", manifest.retention.clock)}
            {row("patch", manifest.retention.patchPath)}
            {row("lock", manifest.retention.lockPath)}
          </div>
        </SummaryCard>
        <SummaryCard title="Report" padding="sm">
          <div className="space-y-2">
            {row("html", manifest.report.htmlPath)}
            {row("api", manifest.report.apiPath)}
          </div>
        </SummaryCard>
        <SummaryCard
          title="Opt-in"
          padding="sm"
          badge={<Pill kind={activeAvailable ? "info" : "unassessed"} label={flagLabel(activeAvailable)} />}
        >
          <div className="space-y-2">
            {row("default", manifest.optIn.default)}
            {row("stats", optInFieldLabel(manifest.optIn.start.optInStats))}
            {row("permanent", optInFieldLabel(manifest.optIn.start.optInPermanent))}
            {row("active", optInFieldLabel(activeField))}
            {row("stats query", manifest.optIn.scan.statsQuery)}
            {row("permanent query", manifest.optIn.scan.permanentQuery)}
            {row("opt-in value", manifest.optIn.scan.optInValue)}
          </div>
        </SummaryCard>
        <SummaryCard title="Availability" padding="sm">
          <div className="space-y-2">
            {row("reverse invite", flagLabel(manifest.reverseInvite.available))}
            {row("platform", flagLabel(manifest.platform.available))}
            {row("tls summary", flagLabel(manifest.tlsSummary.available))}
            {row("session default", manifest.sessionKind.scanDefault)}
            {row("session kinds", manifest.sessionKind.supported.join(", "))}
          </div>
        </SummaryCard>
        <SummaryCard title="Routes" padding="sm">
          <div className="space-y-2">
            {manifest.routes.length === 0 ? (
              <p className="text-sm text-zinc-400">No advertised routes.</p>
            ) : (
              manifest.routes.map((route) => (
                <FieldRow
                  key={`${route.method}:${route.fullPath}`}
                  label={route.method}
                  fullValue={route.fullPath}
                  displayValue={route.fullPath}
                />
              ))
            )}
          </div>
        </SummaryCard>
      </div>
      <RawJsonPanel value={manifest} title="Manifest JSON" downloadName="manifest.json" />
    </div>
  );
}
