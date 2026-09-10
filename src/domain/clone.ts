/** Clone domain snapshots so historical result/provenance state cannot share mutable nested references with live UI state. */
export function cloneDomain<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function freezeDomain<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDomain(child);
  }
  return value;
}
