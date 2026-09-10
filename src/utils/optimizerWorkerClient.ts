import { OptimizerParams, runOptimizer, DEFAULT_SEARCH_BUDGET } from './optimizer';
import { OptimizerOutput } from '../types';
import { WorkerOptimizerRequest, WorkerOptimizerResponse } from '../workers/optimizer.worker';
const workerByRequest = new Map<string, Worker>();
const activeRequests = new Map<string, PendingRequest>();
const ownerRequests = new Map<PendingRequest['owner'], Set<string>>();
let requestSeq = 0;

interface PendingRequest {
  params: OptimizerParams;
  resolve: (value: OptimizerOutput) => void;
  reject: (reason: any) => void;
  cancelled: boolean;
  owner: 'live-estimate' | 'user-run' | 'other';
}

export interface OptimizerTask {
  id: string;
  promise: Promise<OptimizerOutput>;
  cancel: () => void;
}

function removeOwnerRequest(id: string, request: PendingRequest) {
  activeRequests.delete(id);
  const ids = ownerRequests.get(request.owner);
  ids?.delete(id);
  if (ids && ids.size === 0) ownerRequests.delete(request.owner);
}

function terminateRequestWorker(id: string) {
  const worker = workerByRequest.get(id);
  workerByRequest.delete(id);
  try { worker?.terminate(); } catch {}
}

function cancelRequest(id: string) {
  const request = activeRequests.get(id);
  if (!request || request.cancelled) return;
  request.cancelled = true;
  removeOwnerRequest(id, request);
  terminateRequestWorker(id);
  request.reject(new Error('Optimizer request cancelled.'));
}

function cancelOwner(owner: PendingRequest['owner']) {
  const ids = Array.from(ownerRequests.get(owner) || []);
  for (const id of ids) cancelRequest(id);
}

function runOnMainThread(params: OptimizerParams, request: PendingRequest): Promise<OptimizerOutput> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (request.cancelled) { reject(new Error('Optimizer request cancelled.')); return; }
      try {
        const result = runOptimizer({ ...params, shouldCancel: () => request.cancelled, searchBudget: params.searchBudget || DEFAULT_SEARCH_BUDGET });
        if (request.cancelled) reject(new Error('Optimizer request cancelled.'));
        else resolve(result);
      } catch (err) { reject(err); }
    }, 0);
    if (request.cancelled) clearTimeout(timer);
  });
}

function createWorkerForRequest(id: string, request: PendingRequest): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
    workerByRequest.set(id, worker);
    worker.onmessage = (e: MessageEvent<WorkerOptimizerResponse>) => {
      const { id: responseId, type, result, error, errorCode } = e.data;
      const active = activeRequests.get(responseId);
      if (!active) { terminateRequestWorker(responseId); return; }
      if (active.cancelled) { removeOwnerRequest(responseId, active); terminateRequestWorker(responseId); return; }
      terminateRequestWorker(responseId);
      removeOwnerRequest(responseId, active);
      if (type === 'OPTIMIZER_SUCCESS' && result) {
        active.resolve(result);
      } else {
        const prefix = errorCode ? `[${errorCode}] ` : '';
        active.reject(new Error(prefix + (error || 'Optimizer calculation failed')));
      }
    };
    worker.onerror = () => {
      const active = activeRequests.get(id);
      terminateRequestWorker(id);
      if (!active || active.cancelled) return;
      removeOwnerRequest(id, active);
      active.reject(new Error('The schedule search stopped unexpectedly. Try again.'));
    };
    return worker;
  } catch {
    terminateRequestWorker(id);
    return null;
  }
}

export function disposeOptimizerWorker(): void {
  for (const [id, request] of Array.from(activeRequests.entries())) {
    removeOwnerRequest(id, request);
    request.cancelled = true;
    terminateRequestWorker(id);
    request.reject(new Error('Optimizer worker disposed.'));
  }
}

export function cancelOptimizerOwner(owner: PendingRequest['owner']): void {
  cancelOwner(owner);
}

export function runOptimizerAsyncCancellable(
  params: OptimizerParams,
  options: { owner?: PendingRequest['owner']; cancelPreviousOwner?: boolean } = {}
): OptimizerTask {
  const owner = options.owner || 'other';
  if (options.cancelPreviousOwner) cancelOwner(owner);

  requestSeq++;
  const id = `req_${Date.now()}_${requestSeq}`;
  const promise = new Promise<OptimizerOutput>((resolve, reject) => {
    const request: PendingRequest = { params, resolve, reject, cancelled: false, owner };
    activeRequests.set(id, request);
    if (!ownerRequests.has(owner)) ownerRequests.set(owner, new Set());
    ownerRequests.get(owner)!.add(id);

    const worker = createWorkerForRequest(id, request);
    if (!worker) {
      runOnMainThread(params, request).then((result) => {
        if (request.cancelled) return;
        removeOwnerRequest(id, request);
        resolve(result);
      }).catch((err) => {
        if (request.cancelled) return;
        removeOwnerRequest(id, request);
        reject(err);
      });
      return;
    }

    const message: WorkerOptimizerRequest = { id, type: 'RUN_OPTIMIZER', payload: params };
    try { worker.postMessage(message); }
    catch (postErr) {
      console.warn('Failed to post optimizer request to worker; using deferred main-thread fallback.', postErr);
      terminateRequestWorker(id);
      runOnMainThread(params, request).then((result) => {
        if (request.cancelled) return;
        removeOwnerRequest(id, request);
        resolve(result);
      }).catch((err) => {
        if (request.cancelled) return;
        removeOwnerRequest(id, request);
        reject(err);
      });
    }
  });

  return { id, promise, cancel: () => cancelRequest(id) };
}

export function runOptimizerAsync(params: OptimizerParams): Promise<OptimizerOutput> {
  return runOptimizerAsyncCancellable(params).promise;
}
