import type { OptimizationResult, SchedulePreferences } from '../types';
import { scheduleCanonicalSignature } from './results';

export const RANKING_CRITERIA = [
  { key: 'gap', label: 'Less gap time', weight: 1 },
  { key: 'days', label: 'Fewer campus days', weight: 1 },
  { key: 'compactness', label: 'More compact days', weight: 1 },
] as const;

export function compareScheduleRanks(a: OptimizationResult, b: OptimizationResult, preferences: SchedulePreferences): number {
  if (a.totalGap !== b.totalGap) return a.totalGap - b.totalGap;
  if (a.numDays !== b.numDays) return a.numDays - b.numDays;
  if (preferences.preferCompactDays) {
    const spanA = a.latestEndMinutes - a.earliestStartMinutes;
    const spanB = b.latestEndMinutes - b.earliestStartMinutes;
    if (spanA !== spanB) return spanA - spanB;
  }
  return scheduleCanonicalSignature(a).localeCompare(scheduleCanonicalSignature(b));
}

export function rankingLabel(preferences: SchedulePreferences): string {
  return preferences.preferCompactDays
    ? 'Ranked by gap time, then campus days, then daily compactness.'
    : 'Ranked by gap time, then campus days.';
}
