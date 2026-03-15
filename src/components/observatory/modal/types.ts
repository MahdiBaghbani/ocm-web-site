import type { EvidenceItem } from "../lib/contracts";

/** Props shared by all evidence tab panels rendered inside RunModal. */
export interface EvidenceTabProps {
  evidenceItems: EvidenceItem[];
  artifactBase: string;
}
