// TypeScript mirrors of the generated JSON artifact shapes consumed by the site.
// Shape changes here must match the ocmts ingest pipeline's output schemas.

/** Display status on a matrix cell or capability entry. */
export type DisplayStatus =
  | 'supported'
  | 'vendor-unsupported'
  | 'test-implementation-pending'
  | 'vendor-out-of-scope'
  | 'placeholder';

/** Terminal outcome of a single cell run. */
export type ResultStatus =
  | 'passed'
  | 'failed'
  | 'infra-failed'
  | 'cleanup-failed'
  | 'down-failed';

/** Combined UI-level cell status covering all run outcomes and display states. */
export type CellStatus =
  | ResultStatus
  | 'vendor-unsupported'
  | 'test-implementation-pending'
  | 'vendor-out-of-scope'
  | 'placeholder'
  | 'not-run'
  | 'unknown';

export interface ProducerMeta {
  name: string;
  version: string;
}

export interface SourceEntry {
  path: string;
  sha256: string;
}

export interface ExecutionContext {
  kind: string;
  is_ci: boolean;
  is_act: boolean;
  github: Record<string, unknown>;
}

// --- MatrixRules  (public/matrix-rules.v1.json) ---

export interface FlowMetadata {
  flow_id: string;
  label: string;
  subtitle: string;
  display_order: number;
  enabled: boolean;
  two_party: boolean;
  mitm: boolean;
}

export interface MatrixRuleScenario {
  scenario: string;
  flow_id: string;
  pair: string;
  enabled: boolean;
  browser: string;
  sender_platform: string;
  sender_version: string;
  receiver_platform: string;
  receiver_version: string;
  mitm: boolean;
  cell_id: string;
  artifact_name: string;
  display_status: DisplayStatus;
  tracking_url?: string;
  tracking_note?: string;
  rationale?: string;
}

export interface MatrixRules {
  schema_version: number;
  generated_at: string;
  generator: string;
  producer: ProducerMeta;
  sources: SourceEntry[];
  source: string;
  flows: FlowMetadata[];
  scenarios: MatrixRuleScenario[];
}

// --- ImplementedCells  (public/implemented-cells.v1.json) ---

/** Entry in the `blocked_by[]` list on a cell record. */
export interface BlockedByEntry {
  role: string;
  capability: string;
  status: DisplayStatus;
  rationale?: string;
  tracking_url?: string;
  tracking_note?: string;
}

/** Capability requirement wired to an adapter key. */
export interface RequirementEntry {
  capability: string;
  role: string;
  adapter_key: string;
}

/** Fully expanded blocker with reason code and adapter coordinates. */
export interface BlockerEntry {
  reason_code: string;
  role: string;
  adapter_key: string;
  capability: string;
  status: DisplayStatus;
  rationale?: string;
}

export interface ImplementedCell {
  scenario: string;
  flow_id: string;
  pair: string;
  browser: string;
  sender_platform: string;
  sender_version: string;
  receiver_platform: string;
  receiver_version: string;
  artifact_name: string;
  mitm: boolean;
  display_status: DisplayStatus;
  /** Concise blocking constraints used for matrix tooltip rendering. */
  blocked_by: BlockedByEntry[];
  /** Legacy boolean retained for back-compat (true iff display_status === 'supported'). */
  implemented: boolean;
  requirements: RequirementEntry[];
  blockers: BlockerEntry[];
}

export interface ImplementedCells {
  schema_version: number;
  generated_at: string;
  generator: string;
  producer: ProducerMeta;
  sources: SourceEntry[];
  cells: Record<string, ImplementedCell>;
}

// --- MatrixNotInScope  (public/matrix-not-in-scope.v1.json) ---

export interface NotInScopeEntry {
  platform: string;
  version: string;
  rationale: string;
  role: string;
}

export interface MatrixNotInScope {
  schema_version: number;
  generated_at: string;
  generator: string;
  producer: ProducerMeta;
  sources: SourceEntry[];
  /** Per-flow list of platform/version pairs that are deliberately out of scope. */
  flows: Record<string, NotInScopeEntry[]>;
}

// --- SuiteManifest  (public/suite-manifest.v1.json) ---

export interface SuiteManifestFlow {
  id: string;
  description: string;
}

export interface CellManifestEntry {
  id: string;
  flow_id: string;
  pair: string;
  artifact_name: string;
  scenario: string;
  sender_platform: string;
  sender_version: string;
  receiver_platform: string;
  receiver_version: string;
  browser: string;
  is_two_party: boolean;
  scenario_module: string;
}

export interface ImageProvenanceEntry {
  local_image_id: string;
  repo_digests: string[];
}

export interface RunEntry {
  id: string;
  cell_id: string;
  execution_id: string;
  artifact_name: string;
  attempt_number: number;
  retry_of_run_id: string | null;
  superseded_by_run_id: string | null;
  lifecycle_status: string;
  started_at: string;
  finished_at: string;
  stack_id: string;
  execution_context: ExecutionContext;
  /** Role-keyed image tags as launched (legacy shape; see ImagesManifest for richer per-service data). */
  images: Record<string, string>;
  images_provenance: Record<string, ImageProvenanceEntry>;
  stack_def_sha256: string | null;
  stack_env_sha256: string | null;
}

export interface ResultSummaryEvidenceEntry {
  kind: string;
  scope: string;
  logical_name: string;
  path: string;
  availability: string;
  evidence_id: string;
}

export interface ResultSummaryEntry {
  id: string;
  run_id: string;
  cell_id: string;
  status: ResultStatus;
  exit_code: number;
  finished_at: string;
  evidence: ResultSummaryEvidenceEntry[];
}

export interface SuiteManifestIndexes {
  latest_terminal_result_by_cell: Record<string, string>;
}

export interface SuiteManifest {
  schema_version: number;
  generated_at: string;
  generator: string;
  producer: ProducerMeta;
  sources: SourceEntry[];
  execution_context: Record<string, unknown>;
  flows: Record<string, SuiteManifestFlow>;
  cells: Record<string, CellManifestEntry>;
  runs: Record<string, RunEntry>;
  results: Record<string, ResultSummaryEntry>;
  indexes: SuiteManifestIndexes;
}

// --- EvidenceManifest  (meta/evidence.v1.json) ---

/** Envelope kind; determines which renderer the EvidenceViewer dispatches to. */
export type EvidenceEnvelope =
  | 'text-log.v1'
  | 'jsonl.v1'
  | 'event-stream.v1'
  | 'markdown.v1'
  | 'stub.v1';

/** Destination tab in the evidence modal. */
export type EvidenceTab =
  | 'overview'
  | 'screenshots'
  | 'mitm'
  | 'logs'
  | 'meta'
  | 'stack';

export interface EvidenceItem {
  path: string;
  logical_name: string;
  envelope: EvidenceEnvelope;
  tab: EvidenceTab;
  size_bytes: number;
  sha256: string;
  /** Syntax-highlight hint for text-log.v1 items (e.g. 'yaml', 'env'). */
  language?: string;
  /** Set on cypress-run.log to signal ANSI escape sequences are present. */
  ansi?: boolean;
  /** Whether the captured file was truncated at collection time. */
  truncated?: boolean;
  /** Line count for event-stream.v1 items. */
  record_count?: number;
  /** Compose service name; present only for service-derived items. */
  service?: string;
  /** Human-readable reason for stub.v1 sentinels (e.g. "service not present in compose project"). */
  stub_reason?: string;
}

export interface EvidenceManifest {
  schema_version: number;
  captured_at: string;
  cell_id: string;
  run_id: string;
  items: EvidenceItem[];
}

// --- CellResult  (meta/result.v1.json) ---

export interface VerdictStage {
  status: ResultStatus;
  exit_code: number;
}

export interface Verdict {
  /** Lifecycle stage at which the final verdict was recorded (e.g. 'after-down'). */
  stage: string;
  base: VerdictStage;
  final: VerdictStage;
  validators: unknown[];
}

export interface EvidenceSummary {
  total_count: number;
  mitm_present: boolean;
  docker_logs_count: number;
  cypress_screenshots_count: number;
  cypress_videos_count: number;
  cypress_downloads_count: number;
  mitm_files_count: number;
}

export interface CellResult {
  schema_version: number;
  id: string;
  run_id: string;
  execution_id: string;
  cell_id: string;
  artifact_name: string;
  started_at: string;
  finished_at: string;
  status: ResultStatus;
  exit_code: number;
  verdict: Verdict;
  execution_context: ExecutionContext;
  evidence: EvidenceSummary;
  warnings: unknown[];
  suite_id: string;
  suite_kind: string;
}

// --- ImagesManifest  (meta/images.v1.json) ---

export interface ImageServiceEntry {
  service: string;
  /** Legacy role key from meta/run.json.images (e.g. 'platform', 'mitmproxy', 'mariadb'). */
  role: string;
  tag: string;
  local_image_id: string;
  repo_digests: string[];
  /** First element of repo_digests stripped of repo prefix, or null for local-only images. */
  digest: string | null;
}

export interface ImagesManifest {
  schema_version: number;
  captured_at: string;
  stack_id: string;
  services: ImageServiceEntry[];
}

// --- ComposeManifest  (compose/manifest.v1.json) ---

export interface ComposeManifest {
  schema_version: number;
  captured_at: string;
  stack_id: string;
  /** Hash over structural overlay files only; stable across identical stack shapes. */
  stack_def_sha256: string;
  /** Hash over stack.env bytes; changes per-run with image tags and credentials. */
  stack_env_sha256: string;
  base: string;
  applied_inputs: string[];
  resolved_files: string[];
}
