/**
 * Per-area pass rate grid. Rate is pass / (pass + warn + fail) via AreaGrid.
 */
import React from "react";
import AreaGrid, { type AreaGridEntry } from "../atoms/AreaGrid";
import type { ValidatorStatisticsArea } from "../lib/validatorStatistics";

export interface AreaPassRateGridProps {
  areas: readonly ValidatorStatisticsArea[];
}

function toEntries(areas: readonly ValidatorStatisticsArea[]): AreaGridEntry[] {
  return areas.map((area) => ({
    area: area.area,
    pass: area.pass,
    warn: area.warn,
    fail: area.fail,
  }));
}

export default function AreaPassRateGrid({
  areas,
}: AreaPassRateGridProps): React.ReactElement {
  return <AreaGrid areas={toEntries(areas)} />;
}
