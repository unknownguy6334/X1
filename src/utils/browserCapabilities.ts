export interface BrowserCapabilities {
  worker: boolean;
  offscreenCanvas: boolean;
  workerImageDecoder: boolean;
  clipboard: boolean;
  secureContext: boolean;
  storage: boolean;
  abortController: boolean;
  download: boolean;
  share: boolean;
}

export function getBrowserCapabilities(): BrowserCapabilities {
  const g = typeof globalThis !== 'undefined' ? globalThis as any : {};
  const n = typeof navigator !== 'undefined' ? navigator : undefined;
  const w = typeof window !== 'undefined' ? window : undefined;
  return {
    worker: typeof g.Worker !== 'undefined',
    offscreenCanvas: typeof g.OffscreenCanvas !== 'undefined',
    workerImageDecoder: typeof g.createImageBitmap !== 'undefined',
    clipboard: Boolean(n?.clipboard?.writeText),
    secureContext: Boolean(w?.isSecureContext),
    storage: typeof g.localStorage !== 'undefined',
    abortController: typeof g.AbortController !== 'undefined',
    download: typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function',
    share: Boolean(n?.share),
  };
}
