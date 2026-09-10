/**
 * Cross-browser, privacy-mode safe storage wrappers.
 * Protects against QuotaExceededError, SecurityError, sandboxed iframes,
 * and restricted enterprise/private-browsing environments.
 */
type StorageLike = Storage;

function getStore(kind: 'local' | 'session'): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch (e) {
    console.warn(`safeStorage: Could not access ${kind}Storage:`, e);
    return null;
  }
}

function getItem(kind: 'local' | 'session', key: string): string | null {
  try {
    return getStore(kind)?.getItem(key) ?? null;
  } catch (e) {
    console.warn(`safeStorage: Could not read ${kind} key "${key}":`, e);
    return null;
  }
}

function setItem(kind: 'local' | 'session', key: string, value: string): boolean {
  try {
    const store = getStore(kind);
    if (!store) return false;
    store.setItem(key, value);
    return store.getItem(key) === value;
  } catch (e) {
    console.warn(`safeStorage: Could not write ${kind} key "${key}":`, e);
    return false;
  }
}

function removeItem(kind: 'local' | 'session', key: string): boolean {
  try {
    const store = getStore(kind);
    if (!store) return false;
    store.removeItem(key);
    return store.getItem(key) === null;
  } catch (e) {
    console.warn(`safeStorage: Could not remove ${kind} key "${key}":`, e);
    return false;
  }
}

export const safeStorage = {
  getItem: (key: string) => getItem('local', key),
  setItem: (key: string, value: string) => setItem('local', key, value),
  removeItem: (key: string) => removeItem('local', key),

  sessionGetItem: (key: string) => getItem('session', key),
  sessionSetItem: (key: string, value: string) => setItem('session', key, value),
  sessionRemoveItem: (key: string) => removeItem('session', key),

  /** Write to localStorage and verify the exact value before callers discard a source snapshot. */
  setItemVerified: (key: string, value: string) => setItem('local', key, value),

  /** Probe whether localStorage is currently writable without leaving test data behind. */
  isLocalWritable(): boolean {
    const key = `__gadwal_storage_probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const store = getStore('local');
      if (!store) return false;
      store.setItem(key, '1');
      const ok = store.getItem(key) === '1';
      store.removeItem(key);
      return ok;
    } catch {
      return false;
    }
  },
};

export interface StorageEnvelope<T> {
  schemaVersion: string;
  updatedAt: number;
  data: T;
}

export function createStorageEnvelope<T>(data: T, schemaVersion: string): StorageEnvelope<T> {
  return { schemaVersion, updatedAt: Date.now(), data };
}

export function parseStorageEnvelope<T>(raw: string | null): StorageEnvelope<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.schemaVersion === 'string' &&
      Number.isFinite(parsed.updatedAt) &&
      Object.prototype.hasOwnProperty.call(parsed, 'data')
    ) {
      return parsed as StorageEnvelope<T>;
    }
  } catch {}
  return null;
}
