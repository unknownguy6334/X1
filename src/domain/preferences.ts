import type { DayOfWeek, SchedulePreferences } from '../types';

export const DEFAULT_DAY_BUCKETS = [1,2,3,4,5,6,7] as const;
export const TARGET_CREDITS_MIN = 0.5;
export const TARGET_CREDITS_MAX = 100;
export const CREDIT_PRECISION = 0.5;

export function canonicalizePreferences(preferences: SchedulePreferences): SchedulePreferences {
  const targetCredits = preferences.targetCredits == null ? null : Math.round(Number(preferences.targetCredits) / CREDIT_PRECISION) * CREDIT_PRECISION;
  const rawTargetCourseCount = preferences.targetCourseCount == null ? null : Math.floor(Number(preferences.targetCourseCount));
  const targetCourseCount = Number.isFinite(rawTargetCourseCount) ? Math.min(40, Math.max(1, rawTargetCourseCount!)) : null;
  const minCredits = preferences.minCredits == null ? undefined : Math.round(Math.max(TARGET_CREDITS_MIN, Math.min(TARGET_CREDITS_MAX, Number(preferences.minCredits))) / CREDIT_PRECISION) * CREDIT_PRECISION;
  let maxCredits = preferences.maxCredits == null ? undefined : Math.round(Math.max(TARGET_CREDITS_MIN, Math.min(TARGET_CREDITS_MAX, Number(preferences.maxCredits))) / CREDIT_PRECISION) * CREDIT_PRECISION;
  if (minCredits !== undefined && maxCredits !== undefined && minCredits > maxCredits) [minCredits, maxCredits] = [maxCredits, minCredits];
  const earliestStartTime = preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' ? String(preferences.earliestStartTime).trim() : preferences.earliestStartTime;
  const latestEndTime = preferences.latestEndTime && preferences.latestEndTime !== 'ANY' ? String(preferences.latestEndTime).trim() : preferences.latestEndTime;
  return {
    ...preferences,
    mandatoryCourseKeys: Array.from(new Set((preferences.mandatoryCourseKeys || []).map(String).map((v) => v.trim().toLowerCase()).filter(Boolean))).sort(),
    mandatoryCourses: Array.from(new Set((preferences.mandatoryCourses || []).map(String).map((v) => v.trim()).filter(Boolean))).sort(),
    dayBuckets: Array.from(new Set((preferences.dayBuckets || DEFAULT_DAY_BUCKETS).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))).sort((a,b) => a-b),
    freeDays: Array.from(new Set((preferences.freeDays || []).filter((d): d is DayOfWeek => ['SAT','SUN','MON','TUE','WED','THU','FRI'].includes(d)))).sort(),
    targetCredits: Number.isFinite(targetCredits) && targetCredits! >= TARGET_CREDITS_MIN && targetCredits! <= TARGET_CREDITS_MAX ? targetCredits : null,
    targetCourseCount: Number.isFinite(targetCourseCount) ? targetCourseCount : null,
    minCredits: Number.isFinite(minCredits) ? minCredits : undefined,
    maxCredits: Number.isFinite(maxCredits) ? maxCredits : undefined,
    maxDays: preferences.maxDays == null ? null : Math.max(1, Math.min(7, Math.floor(Number(preferences.maxDays)))),
    earliestStartTime,
    latestEndTime,
    preferCompactDays: Boolean(preferences.preferCompactDays),
    useCreditRange: Boolean(preferences.useCreditRange),
  };
}

export function preferencesSemanticKey(preferences: SchedulePreferences): string {
  const p = canonicalizePreferences(preferences);
  return JSON.stringify({ ...p, mandatoryCourses: undefined });
}

export function arePreferencesSemanticallyEqual(a: SchedulePreferences, b: SchedulePreferences): boolean {
  return preferencesSemanticKey(a) === preferencesSemanticKey(b);
}

export function isValidCreditsValue(value: unknown): value is number {
  const n = Number(value);
  return Number.isFinite(n) && n >= TARGET_CREDITS_MIN && n <= TARGET_CREDITS_MAX && Math.abs(n / CREDIT_PRECISION - Math.round(n / CREDIT_PRECISION)) < 1e-9;
}
