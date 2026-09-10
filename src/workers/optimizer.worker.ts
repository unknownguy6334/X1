import { OptimizerParams, runOptimizer } from '../utils/optimizer';
import { OptimizerOutput } from '../types';

export interface WorkerOptimizerRequest {
  id: string;
  type: 'RUN_OPTIMIZER';
  payload: OptimizerParams;
}

export interface WorkerOptimizerResponse {
  id: string;
  type: 'OPTIMIZER_SUCCESS' | 'OPTIMIZER_ERROR';
  result?: OptimizerOutput;
  error?: string;
  errorCode?: string;
}

self.onmessage = (e: MessageEvent<WorkerOptimizerRequest>) => {
  const { id, type, payload } = e.data || {};
  if (type === 'RUN_OPTIMIZER' && payload) {
    try {
      const result = runOptimizer(payload);
      const response: WorkerOptimizerResponse = {
        id,
        type: 'OPTIMIZER_SUCCESS',
        result,
      };
      self.postMessage(response);
    } catch (err: any) {
      const response: WorkerOptimizerResponse = {
        id,
        type: 'OPTIMIZER_ERROR',
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(response);
    }
  }
};
