import { useState, useEffect, useRef, useCallback } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
  ocrServiceAvailable: boolean;
  refreshConnectivity: () => Promise<boolean>;
}

// `navigator.onLine` only reflects whether the device has a network interface that's
// "up" - it reports `true` on a router/AP connection with no real internet route
// (captive portals, DNS-only outages), so relying on it alone means users on such
// connections never see offline messaging and every request just times out with a
// generic error. This lightweight active check periodically confirms real
// connectivity by requesting a small same-origin resource.
const ACTIVE_CHECK_INTERVAL_MS = 30_000;
const ACTIVE_CHECK_TIMEOUT_MS = 5_000;
const ACTIVE_CHECK_URL = `${typeof window !== 'undefined' ? window.location.origin : ''}/favicon.ico`;
const OCR_HEALTH_URL = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/health/ready`;
const SERVICE_CHECK_TIMEOUT_MS = 5000;

async function checkRealConnectivity(signal?: AbortSignal): Promise<boolean> {
  if (typeof fetch === 'undefined') return true;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) return false;
    signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => controller.abort(), ACTIVE_CHECK_TIMEOUT_MS);
  try {
    await fetch(`${ACTIVE_CHECK_URL}?_=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Hook to track browser online/offline status with reconnection detection.
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    }
    return true;
  });
  const [wasOffline, setWasOffline] = useState(false);
  const [ocrServiceAvailable, setOcrServiceAvailable] = useState(true);
  const inFlightRef = useRef(false);
  const prevOnlineRef = useRef(isOnline);
  const isOnlineRef = useRef(isOnline);
  const activeCheckControllerRef = useRef<AbortController | null>(null);

  const checkServiceHealth = useCallback(async (): Promise<boolean> => {
    if (typeof fetch === 'undefined') return true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVICE_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(`${OCR_HEALTH_URL}?_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const refreshConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return true;
    if (inFlightRef.current) return isOnlineRef.current;
    inFlightRef.current = true;
    const controller = new AbortController();
    activeCheckControllerRef.current = controller;
    try {
      const reallyOnline = await checkRealConnectivity(controller.signal);
      if (controller.signal.aborted) return false;
      const serviceAvailable = reallyOnline ? await checkServiceHealth() : false;
      setOcrServiceAvailable(serviceAvailable);
      isOnlineRef.current = reallyOnline;
      if (!reallyOnline) {
        prevOnlineRef.current = false;
        setIsOnline(false);
        return false;
      }
      if (!prevOnlineRef.current) setWasOffline(true);
      prevOnlineRef.current = true;
      setIsOnline(true);
      return true;
    } finally {
      if (activeCheckControllerRef.current === controller) activeCheckControllerRef.current = null;
      inFlightRef.current = false;
    }
  }, [checkServiceHealth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;

    const runActiveCheck = async () => {
      if (!mounted || inFlightRef.current) return;
      await refreshConnectivity();
    };
    const handleOnline = () => { runActiveCheck(); };
    const handleOffline = () => {
      prevOnlineRef.current = false;
      isOnlineRef.current = false;
      setIsOnline(false);
      setOcrServiceAvailable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    runActiveCheck();
    const intervalId = window.setInterval(runActiveCheck, ACTIVE_CHECK_INTERVAL_MS);

    return () => {
      mounted = false;
      activeCheckControllerRef.current?.abort();
      activeCheckControllerRef.current = null;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(intervalId);
    };
  }, [refreshConnectivity]);

  return { isOnline, wasOffline, ocrServiceAvailable, refreshConnectivity };
}
