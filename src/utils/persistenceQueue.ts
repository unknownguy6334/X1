import { STORAGE_WRITE_DEBOUNCE_MS } from '../domain/storage';
import { safeStorage } from './safeStorage';

interface PendingWrite { payload: string; timer: number | null; }
const queue = new Map<string, PendingWrite>();
const lastPayload = new Map<string, string>();

export function queueStorageWrite(key: string, payload: string, delay = STORAGE_WRITE_DEBOUNCE_MS): void {
  if (lastPayload.get(key) === payload) return;
  const previous = queue.get(key);
  if (previous?.timer !== null && previous?.timer !== undefined) window.clearTimeout(previous.timer);
  const timer = window.setTimeout(() => {
    queue.delete(key);
    lastPayload.set(key, payload);
    try { safeStorage.setItem(key, payload); } catch { /* best-effort persistence; owner surfaces warnings */ }
  }, Math.max(0, delay));
  queue.set(key, { payload, timer });
}

export function flushStorageWrite(key: string): void {
  const pending = queue.get(key);
  if (!pending) return;
  if (pending.timer !== null) window.clearTimeout(pending.timer);
  queue.delete(key);
  lastPayload.set(key, pending.payload);
  try { safeStorage.setItem(key, pending.payload); } catch { /* best-effort persistence; owner surfaces warnings */ }
}

export function cancelQueuedStorageWrite(key: string): void {
  const pending = queue.get(key);
  if (!pending) return;
  if (pending.timer !== null) window.clearTimeout(pending.timer);
  queue.delete(key);
}

export function clearQueuedStorageWrites(): void {
  for (const key of queue.keys()) cancelQueuedStorageWrite(key);
}
