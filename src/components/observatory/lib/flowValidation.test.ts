import { describe, expect, test } from "bun:test";
import type { FlowMetadata, MatrixRuleScenario, MatrixRules } from "./contracts";
import {
  getFlowMetadataValidationError,
  validateMatrixRulesFlows,
} from "./flowValidation";
import { isSupportedGlyphId, SUPPORTED_GLYPH_IDS } from "./glyphRegistry";

function makeFlow(overrides: Partial<FlowMetadata> = {}): FlowMetadata {
  return {
    flow_id: "login",
    label: "Login",
    subtitle: "",
    glyph_id: "key",
    display_order: 1,
    enabled: true,
    two_party: false,
    mitm: false,
    ...overrides,
  };
}

function makeScenario(overrides: Partial<MatrixRuleScenario> = {}): MatrixRuleScenario {
  return {
    matrix_key: "login__nextcloud",
    flow_id: "login",
    pair: "nextcloud",
    enabled: true,
    browser: "chrome",
    sender_platform: "nextcloud",
    sender_version: "32",
    receiver_platform: "",
    receiver_version: "",
    mitm: false,
    cell_id: "login__nextcloud__chrome",
    artifact_name: "login",
    display_status: "supported",
    ...overrides,
  };
}

function makeRules(
  flows: FlowMetadata[],
  matrix: MatrixRuleScenario[],
): MatrixRules {
  return {
    schema_version: 1,
    generated_at: "2026-01-01T00:00:00Z",
    generator: "test",
    producer: { name: "test", version: "0" },
    sources: [],
    source: "test",
    flows,
    matrix,
  };
}

describe("glyphRegistry", () => {
  test("lists the published glyph allowlist", () => {
    expect([...SUPPORTED_GLYPH_IDS]).toEqual([
      "key",
      "share-2",
      "ticket",
      "compass",
      "app-window",
    ]);
  });

  test("accepts supported glyph ids", () => {
    expect(isSupportedGlyphId("key")).toBe(true);
    expect(isSupportedGlyphId("share-2")).toBe(true);
    expect(isSupportedGlyphId("app-window")).toBe(true);
  });

  test("rejects unsupported glyph ids", () => {
    expect(isSupportedGlyphId("login")).toBe(false);
    expect(isSupportedGlyphId("")).toBe(false);
  });
});

describe("getFlowMetadataValidationError", () => {
  test("returns null for valid metadata", () => {
    expect(getFlowMetadataValidationError("login", makeFlow())).toBeNull();
  });

  test("flags missing metadata", () => {
    expect(getFlowMetadataValidationError("login", undefined)).toBe(
      'flow "login": missing metadata in matrix-rules flows[]',
    );
  });

  test("flags missing or blank label", () => {
    expect(getFlowMetadataValidationError("login", makeFlow({ label: "  " }))).toBe(
      'flow "login": missing or empty label',
    );
  });

  test("flags missing or blank glyph_id", () => {
    expect(getFlowMetadataValidationError("login", makeFlow({ glyph_id: "" }))).toBe(
      'flow "login": missing or empty glyph_id',
    );
  });

  test("flags whitespace-only glyph_id as padded, not blank", () => {
    expect(getFlowMetadataValidationError("login", makeFlow({ glyph_id: "   " }))).toBe(
      'flow "login": glyph_id "   " must not have leading or trailing whitespace',
    );
  });

  test("flags whitespace-padded otherwise-supported glyph_id", () => {
    expect(getFlowMetadataValidationError("login", makeFlow({ glyph_id: " key " }))).toBe(
      'flow "login": glyph_id " key " must not have leading or trailing whitespace',
    );
  });

  test("flags unsupported glyph_id", () => {
    expect(
      getFlowMetadataValidationError("login", makeFlow({ glyph_id: "unknown" })),
    ).toBe('flow "login": unsupported glyph_id "unknown"');
  });
});

describe("validateMatrixRulesFlows", () => {
  test("accepts valid matrix-rules payload", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    expect(validateMatrixRulesFlows(rules)).toBeNull();
  });

  test("rejects missing matrix flow_id", () => {
    const rules = makeRules(
      [makeFlow()],
      [makeScenario({ flow_id: "", cell_id: "cell-a" })],
    );
    expect(validateMatrixRulesFlows(rules)).toBe(
      'matrix[0]: missing or empty flow_id (cell_id "cell-a")',
    );
  });

  test("rejects blank matrix flow_id", () => {
    const rules = makeRules([makeFlow()], [makeScenario({ flow_id: "   " })]);
    expect(validateMatrixRulesFlows(rules)).toBe(
      'matrix[0]: flow_id "   " must not have leading or trailing whitespace (cell_id "login__nextcloud__chrome")',
    );
  });

  test("rejects whitespace-padded matrix flow_id", () => {
    const rules = makeRules([makeFlow()], [makeScenario({ flow_id: " login " })]);
    expect(validateMatrixRulesFlows(rules)).toBe(
      'matrix[0]: flow_id " login " must not have leading or trailing whitespace (cell_id "login__nextcloud__chrome")',
    );
  });

  test("rejects whitespace-padded flows[] flow_id", () => {
    const rules = makeRules(
      [makeFlow({ flow_id: " login " })],
      [makeScenario({ flow_id: "login" })],
    );
    expect(validateMatrixRulesFlows(rules)).toBe(
      'flows[]: flow_id " login " must not have leading or trailing whitespace',
    );
  });

  test("rejects missing or empty flows[] flow_id", () => {
    const rules = makeRules([makeFlow({ flow_id: "" })], []);
    expect(validateMatrixRulesFlows(rules)).toBe("flows[]: missing or empty flow_id");
  });

  test("rejects matrix flow_id without flows metadata", () => {
    const rules = makeRules([], [makeScenario({ flow_id: "login" })]);
    expect(validateMatrixRulesFlows(rules)).toBe(
      'flow "login": missing metadata in matrix-rules flows[]',
    );
  });

  test("rejects matrix flow_id with invalid flow metadata", () => {
    const rules = makeRules(
      [makeFlow({ glyph_id: "not-a-glyph" })],
      [makeScenario()],
    );
    expect(validateMatrixRulesFlows(rules)).toBe(
      'flow "login": unsupported glyph_id "not-a-glyph"',
    );
  });

  test("rejects whitespace-padded glyph_id in flows metadata", () => {
    const rules = makeRules(
      [makeFlow({ glyph_id: " key " })],
      [makeScenario()],
    );
    expect(validateMatrixRulesFlows(rules)).toBe(
      'flow "login": glyph_id " key " must not have leading or trailing whitespace',
    );
  });

  test("rejects missing flows", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    delete (rules as { flows?: FlowMetadata[] }).flows;
    expect(validateMatrixRulesFlows(rules)).toBe("flows[]: missing or not an array");
  });

  test("rejects non-array flows", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    (rules as { flows: unknown }).flows = {};
    expect(validateMatrixRulesFlows(rules)).toBe("flows[]: missing or not an array");
  });

  test("rejects missing matrix", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    delete (rules as { matrix?: MatrixRuleScenario[] }).matrix;
    expect(validateMatrixRulesFlows(rules)).toBe("matrix[]: missing or not an array");
  });

  test("rejects non-array matrix", () => {
    const rules = makeRules([makeFlow()], [makeScenario()]);
    (rules as { matrix: unknown }).matrix = null;
    expect(validateMatrixRulesFlows(rules)).toBe("matrix[]: missing or not an array");
  });

  test("rejects duplicate flows[] flow_id", () => {
    const rules = makeRules(
      [makeFlow({ flow_id: "login" }), makeFlow({ flow_id: "login", label: "Login duplicate" })],
      [makeScenario()],
    );
    expect(validateMatrixRulesFlows(rules)).toBe('flows[]: duplicate flow_id "login"');
  });
});
