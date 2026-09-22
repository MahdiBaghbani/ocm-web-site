import { describe, expect, test } from "bun:test";
import type { FlowMetadata } from "@/components/observatory/lib/contracts";
import {
  canRenderObservatory,
  canRenderRunModal,
  evaluateMatrixRulesLoad,
  runModalRenderContext,
} from "@/components/observatory/lib/matrixRulesLoad";
import {
  makeFlow,
  makeRules,
  makeScenario,
} from "@/components/observatory/tests/lib/helpers/observatoryFactories";

const openRunOverlay = {
  kind: "run" as const,
  runId: "run-1",
  cellId: "login__nextcloud__chrome",
};

describe("evaluateMatrixRulesLoad", () => {
  test("valid rules allow observatory rendering and RunModal when overlay is open", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.error).toBeNull();
    expect(outcome.rules).toBe(rules);
    expect(outcome.closeOverlay).toBe(false);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(true);
    expect(canRenderRunModal(outcome.rules, outcome.error ?? "", openRunOverlay)).toBe(
      true,
    );
  });

  test("invalid flow metadata blocks observatory and closes overlay", () => {
    const rules = makeRules(
      [makeFlow({ glyph_id: "not-a-glyph" })],
      [makeScenario()],
    );
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe('flow "login": unsupported glyph_id "not-a-glyph"');
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
    expect(canRenderRunModal(outcome.rules, outcome.error ?? "", openRunOverlay)).toBe(
      false,
    );
  });

  test("whitespace-padded matrix flow_id blocks observatory and closes overlay", () => {
    const rules = makeRules([makeFlow()], [makeScenario({ flow_id: " login " })]);
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe(
      'matrix[0]: flow_id " login " must not have leading or trailing whitespace (cell_id "login__nextcloud__chrome")',
    );
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
    expect(canRenderRunModal(outcome.rules, outcome.error ?? "", openRunOverlay)).toBe(
      false,
    );
  });

  test("whitespace-padded flows[] flow_id blocks observatory and closes overlay", () => {
    const rules = makeRules(
      [makeFlow({ flow_id: " login " })],
      [makeScenario({ flow_id: "login" })],
    );
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe(
      'flows[]: flow_id " login " must not have leading or trailing whitespace',
    );
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
    expect(canRenderRunModal(outcome.rules, outcome.error ?? "", openRunOverlay)).toBe(
      false,
    );
  });

  test("whitespace-padded glyph_id blocks observatory and closes overlay", () => {
    const rules = makeRules(
      [makeFlow({ glyph_id: " key " })],
      [makeScenario()],
    );
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe(
      'flow "login": glyph_id " key " must not have leading or trailing whitespace',
    );
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
    expect(canRenderRunModal(outcome.rules, outcome.error ?? "", openRunOverlay)).toBe(
      false,
    );
  });

  test("missing flows blocks observatory and closes overlay", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    delete (rules as { flows?: FlowMetadata[] }).flows;
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe("flows[]: missing or not an array");
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
  });

  test("non-array matrix blocks observatory and closes overlay", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    (rules as { matrix: unknown }).matrix = "not-an-array";
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe("matrix[]: missing or not an array");
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
  });

  test("duplicate flows[] flow_id blocks observatory and closes overlay", () => {
    const rules = makeRules(
      [makeFlow({ flow_id: "login" }), makeFlow({ flow_id: "login", label: "Dup" })],
      [makeScenario()],
    );
    const outcome = evaluateMatrixRulesLoad(rules);

    expect(outcome.rules).toBeNull();
    expect(outcome.error).toBe('flows[]: duplicate flow_id "login"');
    expect(outcome.closeOverlay).toBe(true);
    expect(canRenderObservatory(outcome.rules, outcome.error ?? "")).toBe(false);
  });
});

describe("runModalRenderContext", () => {
  test("returns narrowed context when rules are valid and overlay is open", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    const ctx = runModalRenderContext(rules, "", openRunOverlay);

    expect(ctx).toEqual({ rules, overlay: openRunOverlay });
  });

  test("returns null when load error is present", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    expect(runModalRenderContext(rules, "load failed", openRunOverlay)).toBeNull();
  });

  test("returns null when overlay is closed", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    expect(runModalRenderContext(rules, "", { kind: "closed" })).toBeNull();
  });

  test("returns null when rules are null", () => {
    expect(runModalRenderContext(null, "", openRunOverlay)).toBeNull();
  });

  test("returns null when rules failed validation", () => {
    const outcome = evaluateMatrixRulesLoad(
      makeRules([makeFlow({ glyph_id: "not-a-glyph" })], [makeScenario()]),
    );
    expect(
      runModalRenderContext(outcome.rules, outcome.error ?? "", openRunOverlay),
    ).toBeNull();
  });
});
