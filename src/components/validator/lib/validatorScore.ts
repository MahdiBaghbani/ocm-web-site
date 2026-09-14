/**
 * Thin barrel preserving the historic validatorScore public surface.
 * Implementation now lives under ./score; see ./score/index for the domain
 * barrel.
 */

export {
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_LABELS,
  CANONICAL_AREA_TOTAL,
  isCanonicalAreaId,
  type CanonicalAreaId,
} from "./score/index";

export {
  foldOverallSpecificationGrade,
  isUsableSpecificationScore,
  parseSpecificationScore,
  recountCanonicalAreaGrades,
  specificationFromReport,
  type ParsedSpecificationScore,
  type SpecificationAreaScore,
  type SpecificationGrade,
  type SpecificationScore,
} from "./score/index";

export {
  AREA_RESULT_PILL,
  RESULT_HEADLINE,
  areaGridEntriesFromScore,
  isInconclusiveSpecification,
  projectValidatorScore,
  resolveSpecificationGrade,
  resolveTerminalState,
  type ProjectValidatorScoreInput,
  type SpecificationAreaGridEntry,
  type ValidatorScoreOutcomeKind,
  type ValidatorScoreProjection,
} from "./score/index";
