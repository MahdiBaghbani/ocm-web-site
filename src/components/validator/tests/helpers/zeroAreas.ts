// Shared eight-zero area totals fixture. Used by StatisticsShell fetch
// fixtures and by loose island tests that render AreaPassRateGrid.

import { CANONICAL_AREA_IDS } from "@/components/validator/lib/score/areas";

export function zeroAreas(): Array<{ area: string; pass: number; warn: number; fail: number }> {
  return CANONICAL_AREA_IDS.map((area) => ({ area, pass: 0, warn: 0, fail: 0 }));
}
