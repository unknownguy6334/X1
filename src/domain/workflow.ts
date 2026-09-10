export type WorkflowPhase = 'idle' | 'ready' | 'processing' | 'partial-success' | 'results' | 'stale' | 'cancelled' | 'retryable-error' | 'error';

export interface WorkflowSnapshot {
  generationId: string;
  phase: WorkflowPhase;
  capturedAt: number;
}

export function createGenerationId(prefix = 'wf'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
