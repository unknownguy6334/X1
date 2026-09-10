import type { Section } from '../../types';

export interface AddSectionsResult {
  insertedSections: Section[];
  updatedSections: Section[];
  updatedAllSections: Section[];
  skippedCount: number;
  updatedCount: number;
  creditsAdjustedCount: number;
}

export interface BatchInputFile {
  id: string;
  sourceIndex: number;
  name: string;
  contentHash: string | null;
  visualFingerprint: string | null;
  data: string;
  mimeType: string;
}

export interface BatchInput {
  batchId: string;
  workflowGenerationId: string;
  createdAt: number;
  files: readonly BatchInputFile[];
}

export interface ReviewSourceMetadata {
  source: 'live' | 'recovered';
  evidenceAvailable: boolean;
  evidenceVersion: string;
  reviewGenerationId: string;
}
