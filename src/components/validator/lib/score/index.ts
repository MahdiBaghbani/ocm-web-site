/**
 * Public barrel for the validator score domain. Named re-exports only.
 */

export {
  AREA_DESCRIPTIONS,
  CANONICAL_AREA_IDS,
  CANONICAL_AREA_LABELS,
  CANONICAL_AREA_TOTAL,
  isCanonicalAreaId,
  type CanonicalAreaId,
} from "./areas";

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
} from "./parse";

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
} from "./project";
