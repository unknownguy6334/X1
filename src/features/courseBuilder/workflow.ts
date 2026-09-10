export type CourseBuilderPhase =
  | 'idle' | 'adding' | 'uploading' | 'extracting' | 'needs-review'
  | 'ready' | 'generating' | 'results' | 'stale' | 'error' | 'cancelled' | 'retryable-error' | 'partial-success';

export type CourseBuilderAction =
  | { type: 'RESET' }
  | { type: 'ADD_STARTED' }
  | { type: 'UPLOAD_STARTED' }
  | { type: 'EXTRACTION_STARTED' }
  | { type: 'REVIEW_REQUIRED' }
  | { type: 'READY' }
  | { type: 'GENERATION_STARTED' }
  | { type: 'RESULTS_READY' }
  | { type: 'STALE' }
  | { type: 'ERROR'; reasonCode?: string; retryable?: boolean }
  | { type: 'CANCELLED' }
  | { type: 'PARTIAL_SUCCESS' }
  | { type: 'RETRYABLE_ERROR'; reasonCode?: string }
  | { type: 'RECOVERED' };

export interface CourseBuilderWorkflowState { phase: CourseBuilderPhase; }

export const initialCourseBuilderWorkflow: CourseBuilderWorkflowState = { phase: 'idle' };

export function courseBuilderWorkflowReducer(
  state: CourseBuilderWorkflowState,
  action: CourseBuilderAction,
): CourseBuilderWorkflowState {
  switch (action.type) {
    case 'RESET': return { phase: 'idle' };
    case 'ADD_STARTED': return { phase: 'adding' };
    case 'UPLOAD_STARTED': return { phase: 'uploading' };
    case 'EXTRACTION_STARTED': return { phase: 'extracting' };
    case 'REVIEW_REQUIRED': return { phase: 'needs-review' };
    case 'READY': return { phase: 'ready' };
    case 'GENERATION_STARTED': return { phase: 'generating' };
    case 'RESULTS_READY': return { phase: 'results' };
    case 'STALE': return { phase: 'stale' };
    case 'ERROR': return { phase: 'error' };
    case 'CANCELLED': return { phase: 'cancelled' };
    case 'PARTIAL_SUCCESS': return { phase: 'partial-success' };
    case 'RETRYABLE_ERROR': return { phase: 'retryable-error' };
    case 'RECOVERED': return { phase: 'ready' };
    default: return state;
  }
}


export function reconcileCourseBuilderWorkflow(state: CourseBuilderWorkflowState, facts: { hasSections: boolean; hasResults: boolean; isStale: boolean; isProcessing?: boolean; hasRetryableError?: boolean; hasPartialSuccess?: boolean }): CourseBuilderWorkflowState {
  if (!facts.hasSections && state.phase !== 'idle' && state.phase !== 'adding' && state.phase !== 'uploading' && state.phase !== 'extracting') return { phase: 'idle' };
  if (facts.isProcessing) return state;
  if (facts.hasPartialSuccess && state.phase === 'extracting') return { phase: 'partial-success' };
  if (facts.hasRetryableError && state.phase === 'error') return { phase: 'retryable-error' };
  if (facts.hasResults && facts.isStale && state.phase === 'results') return { phase: 'stale' };
  if (facts.hasResults && !facts.isStale && state.phase === 'idle') return { phase: 'results' };
  if (facts.hasSections && state.phase === 'idle') return { phase: 'ready' };
  return state;
}
