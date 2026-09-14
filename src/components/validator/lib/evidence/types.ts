/**
 * Shared evidence DTO for validator report rows. Lib-owned so reasons
 * and other lib modules can import it without an atoms edge.
 */

export type EvidenceGrade = "pass" | "fail" | "warn";

export interface EvidenceItem {
  area?: string;
  scoreArea?: string;
  leg?: string;
  step?: string;
  reasonCode?: string;
  severity?: string;
  grade?: EvidenceGrade | null;
  affectsGrade?: boolean;
  payloadRedacted?: boolean;
  createdAt?: string;
}
