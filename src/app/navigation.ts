import type { AppStep } from '../types';

export const STEP_HASHES: Record<AppStep, string> = { home: '#home', setup: '#setup', results: '#results' };
export type InfoModal = 'demo' | 'how-it-works' | 'promise' | 'privacy';
export const INFO_MODAL_HASHES: Record<InfoModal, string> = { demo: '#guide', 'how-it-works': '#how-it-works', promise: '#promise', privacy: '#privacy' };

export function isAppStep(value: unknown): value is AppStep {
  return value === 'home' || value === 'setup' || value === 'results';
}
export function isInfoModal(value: unknown): value is InfoModal {
  return value === 'demo' || value === 'how-it-works' || value === 'promise' || value === 'privacy';
}
export function getInfoModalFromHash(hash: string): InfoModal | null {
  const found = Object.entries(INFO_MODAL_HASHES).find(([, v]) => v === hash.toLowerCase());
  return found ? found[0] as InfoModal : null;
}
export function getStepFromLocation(hash: string, pathname: string): AppStep | null {
  const h = hash.toLowerCase(); const p = pathname.toLowerCase();
  if (h === '#home' || (!h && p === '/home')) return 'home';
  if (h === '#setup' || (!h && p === '/setup')) return 'setup';
  if (h === '#results' || (!h && p === '/results')) return 'results';
  return null;
}
export function getStepHash(step: AppStep): string { return STEP_HASHES[step]; }
export function canonicalRoute(step: AppStep): string { return STEP_HASHES[step]; }
