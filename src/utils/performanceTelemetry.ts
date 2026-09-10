export type PerformanceMetricName = 'optimizer' | 'ocr-batch' | 'ocr-image' | 'export-pdf' | 'export-image';

export interface PerformanceMetric {
  name: PerformanceMetricName;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, number | string | boolean | null | undefined>;
}

const MAX_RETAINED_METRICS = 200;
const metrics: PerformanceMetric[] = [];

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function startPerformanceTimer(): () => number {
  const startedAt = now();
  return () => Math.max(0, now() - startedAt);
}

export function recordPerformanceMetric(
  name: PerformanceMetricName,
  durationMs: number,
  metadata?: PerformanceMetric['metadata'],
): void {
  const metric: PerformanceMetric = {
    name,
    durationMs: Math.round(Math.max(0, durationMs) * 100) / 100,
    timestamp: Date.now(),
    metadata,
  };
  metrics.push(metric);
  if (metrics.length > MAX_RETAINED_METRICS) metrics.splice(0, metrics.length - MAX_RETAINED_METRICS);

  // Diagnostics only; no user content, course names, OCR payloads, or identifiers are logged.
  const debugEnabled = (globalThis as any).__GADWAL_PERF_DEBUG__ === true;
  if (debugEnabled && typeof console !== 'undefined') {
    console.debug(`[perf:${name}] ${metric.durationMs}ms`, metadata ?? '');
  }
}

export function getPerformanceMetrics(): PerformanceMetric[] {
  return metrics.map((metric) => ({ ...metric, metadata: metric.metadata ? { ...metric.metadata } : undefined }));
}

export function clearPerformanceMetrics(): void {
  metrics.length = 0;
}
