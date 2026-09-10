import type { OptimizationResult, OptimizerOutput, Section } from '../types';
import { canonicalSectionFingerprint } from './identity';

export const RESULT_CONTRACT_VERSION = 'v3';

export interface ResultSnapshotMetadata {
  version: string;
  complete: boolean;
  sectionCount: number;
  workflowGenerationId: string;
}

export function scheduleCanonicalSignature(schedule: OptimizationResult): string {
  return JSON.stringify({ sections: schedule.sections.map(canonicalSectionFingerprint).sort(), days: [...schedule.days].sort(), numDays: schedule.numDays, totalCredits: schedule.totalCredits });
}

export function resultSnapshotIsComplete(output: Pick<OptimizerOutput, 'sectionsSnapshot'>): boolean {
  return Array.isArray(output.sectionsSnapshot) && output.sectionsSnapshot.length > 0 && output.sectionsSnapshot.every((s) => Array.isArray(s.sessions));
}

export function outputSearchState(output: OptimizerOutput): 'exhaustive' | 'sampled' | 'capped' | 'cancelled' | 'not_searched' | 'preflight_rejected' | 'unknown' {
  return output.searchCompleteness || 'unknown';
}
