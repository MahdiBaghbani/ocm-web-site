import type {
  FlowMetadata,
  MatrixRuleScenario,
  MatrixRules,
} from "@/components/observatory/lib/contracts";

export function makeFlow(overrides: Partial<FlowMetadata> = {}): FlowMetadata {
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

export function makeScenario(overrides: Partial<MatrixRuleScenario> = {}): MatrixRuleScenario {
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

export function makeRules(matrix: MatrixRuleScenario[]): MatrixRules;
export function makeRules(flows: FlowMetadata[], matrix: MatrixRuleScenario[]): MatrixRules;
export function makeRules(
  ...args:
    | [matrix: MatrixRuleScenario[]]
    | [flows: FlowMetadata[], matrix: MatrixRuleScenario[]]
): MatrixRules {
  const flows = args.length === 2 ? args[0] : [makeFlow()];
  const matrix = args.length === 2 ? args[1] : args[0];
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
