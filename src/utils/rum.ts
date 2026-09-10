const sent = new Set<string>();

export function initWebVitalsReporting() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  const report = (name: string, value: number) => {
    if (!Number.isFinite(value) || sent.has(name)) return;
    sent.add(name);
    const safeName = /^(LCP|CLS|INP|FCP|TTFB|FID)$/.test(name) ? name : 'UNKNOWN';
    if (safeName === 'UNKNOWN') return;
    const rawPath = window.location.pathname || '/';
    const path = rawPath.length <= 120 ? rawPath : rawPath.slice(0, 120);
    const body = JSON.stringify({ name: safeName, value: Math.round(value), path });
    try { navigator.sendBeacon('/api/telemetry/web-vitals', new Blob([body], { type: 'application/json' })); }
    catch { void fetch('/api/telemetry/web-vitals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }); }
  };
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
      const obs = new PerformanceObserver((list) => { const last = list.getEntries().at(-1); if (last) report('LCP', last.startTime); });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      let cls = 0;
      const obs = new PerformanceObserver((list) => { for (const entry of list.getEntries() as any) if (!entry.hadRecentInput) cls += entry.value; report('CLS', cls * 1000); });
      obs.observe({ type: 'layout-shift', buffered: true });
    }
  } catch { /* Performance APIs vary by browser. */ }
}
