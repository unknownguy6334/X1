import type { OptimizerOutput, SchedulePreferences, Section } from '../types';
import { cloneDomain, freezeDomain } from './clone';

export const WORKFLOW_SNAPSHOT_VERSION = 'v1' as const;

export interface WorkflowSnapshot {
  version: typeof WORKFLOW_SNAPSHOT_VERSION;
  workflowGenerationId: string;
  createdAt: number;
  sections: readonly Section[];
  preferences: Readonly<SchedulePreferences>;
  sectionsSignature: string;
  preferencesSignature: string;
}

export interface OptimizerInputSnapshot {
  version: typeof WORKFLOW_SNAPSHOT_VERSION;
  workflowGenerationId: string;
  createdAt: number;
  sections: readonly Section[];
  preferences: Readonly<SchedulePreferences>;
  sectionsSignature: string;
  preferencesSignature: string;
  allSectionsConsidered: readonly Section[];
}

export function createWorkflowSnapshot(input: {
  workflowGenerationId: string;
  sections: Section[];
  preferences: SchedulePreferences;
  sectionsSignature: string;
  preferencesSignature: string;
}): WorkflowSnapshot {
  return freezeDomain({
    version: WORKFLOW_SNAPSHOT_VERSION,
    workflowGenerationId: input.workflowGenerationId,
    createdAt: Date.now(),
    sections: cloneDomain(input.sections),
    preferences: cloneDomain(input.preferences),
    sectionsSignature: input.sectionsSignature,
    preferencesSignature: input.preferencesSignature,
  });
}

export function createOptimizerInputSnapshot(input: {
  workflowGenerationId: string;
  sections: Section[];
  preferences: SchedulePreferences;
  sectionsSignature: string;
  preferencesSignature: string;
}): OptimizerInputSnapshot {
  const snapshot = createWorkflowSnapshot(input);
  return freezeDomain({
    ...snapshot,
    allSectionsConsidered: cloneDomain(input.sections),
  });
}

export function attachSnapshotMetadata(output: OptimizerOutput, snapshot: OptimizerInputSnapshot): OptimizerOutput {
  return {
    ...output,
    workflowGenerationId: snapshot.workflowGenerationId,
    generatedInputsSignature: `${snapshot.sectionsSignature}::${snapshot.preferencesSignature}`,
    sectionsSnapshot: cloneDomain(snapshot.sections),
    preferencesUsed: cloneDomain(snapshot.preferences),
  };
}
