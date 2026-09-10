import { DayOfWeek, SchedulePreferences, Section } from '../types';
import { normalizeTimeWithPolicy } from './timeParsingPolicy';
import { getCourseIdentityKey, normalizeCourseName } from './courseUtils';

export const VALID_DAYS: DayOfWeek[] = ['SAT','SUN','MON','TUE','WED','THU','FRI'];
export const TARGET_CREDITS_MIN = 0.5;
export const TARGET_CREDITS_MAX = 100;
export const SECTION_CREDITS_MIN = 0;
export const SECTION_CREDITS_MAX = 17;
export const SECTION_CREDITS_STEP = 0.5;
export const CREDIT_PRECISION_STEP = 0.5;
export const TARGET_COURSE_COUNT_MAX = 40;

export function isValidTargetCredits(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= TARGET_CREDITS_MIN && value <= TARGET_CREDITS_MAX && Math.abs(value / CREDIT_PRECISION_STEP - Math.round(value / CREDIT_PRECISION_STEP)) < 1e-9;
}

export function normalizeMandatoryCourses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const norm = normalizeCourseName(trimmed);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    result.push(trimmed);
  }
  return result;
}


export function normalizeMandatoryCourseKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function normalizePreferenceTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().toUpperCase() === 'ANY') return 'ANY';
  return normalizeTimeWithPolicy(value.trim()) ?? 'ANY';
}

export function sanitizePreferenceValues(value: unknown): Pick<SchedulePreferences, 'targetCredits'|'dayBuckets'|'targetCourseCount'|'mandatoryCourses'|'mandatoryCourseKeys'|'useCreditRange'|'minCredits'|'maxCredits'|'earliestStartTime'|'latestEndTime'|'freeDays'|'maxDays'|'preferCompactDays'> {
  const parsed = value && typeof value === 'object' ? value as Partial<SchedulePreferences> : {};
  const dayBuckets = Array.from(new Set((Array.isArray(parsed.dayBuckets) ? parsed.dayBuckets : [1,2,3,4,5,6,7]).filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))).sort((a,b) => a-b);
  const targetCredits = isValidTargetCredits(parsed.targetCredits) ? parsed.targetCredits : null;
  const rawTargetCourseCount = Number.isInteger(parsed.targetCourseCount as number) ? Number(parsed.targetCourseCount) : NaN;
  const targetCourseCount = Number.isFinite(rawTargetCourseCount) && rawTargetCourseCount > 0 && rawTargetCourseCount <= TARGET_COURSE_COUNT_MAX ? Math.floor(rawTargetCourseCount) : null;
  const minCredits = Number.isFinite(parsed.minCredits as number) && Number(parsed.minCredits) >= 0 && Number(parsed.minCredits) <= TARGET_CREDITS_MAX ? Math.round(Number(parsed.minCredits) / CREDIT_PRECISION_STEP) * CREDIT_PRECISION_STEP : undefined;
  const maxCredits = Number.isFinite(parsed.maxCredits as number) && Number(parsed.maxCredits) >= 0 && Number(parsed.maxCredits) <= TARGET_CREDITS_MAX ? Math.round(Number(parsed.maxCredits) / CREDIT_PRECISION_STEP) * CREDIT_PRECISION_STEP : undefined;
  return {
    targetCredits,
    dayBuckets,
    targetCourseCount,
    mandatoryCourses: normalizeMandatoryCourses(parsed.mandatoryCourses),
    mandatoryCourseKeys: normalizeMandatoryCourseKeys(parsed.mandatoryCourseKeys),
    useCreditRange: parsed.useCreditRange === true,
    minCredits: minCredits !== undefined && maxCredits !== undefined && minCredits > maxCredits ? maxCredits : minCredits,
    maxCredits: minCredits !== undefined && maxCredits !== undefined && minCredits > maxCredits ? minCredits : maxCredits,
    earliestStartTime: normalizePreferenceTime(parsed.earliestStartTime),
    latestEndTime: normalizePreferenceTime(parsed.latestEndTime),
    freeDays: Array.isArray(parsed.freeDays) ? parsed.freeDays.filter((d): d is DayOfWeek => VALID_DAYS.includes(d as DayOfWeek)) : [],
    maxDays: Number.isInteger(parsed.maxDays as number) && (parsed.maxDays as number) >= 1 && (parsed.maxDays as number) <= 7 ? parsed.maxDays as number : null,
    preferCompactDays: parsed.preferCompactDays === true,
  };
}

export function reconcilePreferencesWithCatalog(preferences: SchedulePreferences, catalogSections: Section[], totalCredits: number): SchedulePreferences {
  const courseGroups = new Map<string, Section>();
  for (const section of catalogSections) {
    const key = section.courseKey || getCourseIdentityKey(section.courseCode, section.name);
    if (!courseGroups.has(key)) courseGroups.set(key, section);
  }
  const groups = Array.from(courseGroups.entries());
  const legacyNames = normalizeMandatoryCourses(preferences.mandatoryCourses).map(normalizeCourseName).filter(Boolean);
  const existingKeys = new Set(groups.map(([key]) => key));
  const mandatoryCourseKeys = normalizeMandatoryCourseKeys(preferences.mandatoryCourseKeys)
    .filter((key) => existingKeys.has(key));
  // Legacy names are migrated only when the name resolves to exactly one identity.
  // Same-name/different-code courses are intentionally left unresolved so the UI can
  // make the identity explicit instead of silently marking multiple courses mandatory.
  for (const legacyName of legacyNames) {
    const matches = groups.filter(([, section]) => normalizeCourseName(section.name) === legacyName);
    if (matches.length === 1 && !mandatoryCourseKeys.some((key) => key.toLowerCase() === matches[0][0].toLowerCase())) {
      mandatoryCourseKeys.push(matches[0][0]);
    }
  }
  const uniqueMandatoryKeys = Array.from(new Set(mandatoryCourseKeys));
  const mandatoryCourses = groups
    .filter(([key]) => uniqueMandatoryKeys.includes(key))
    .map(([, section]) => section.name.trim())
    .filter(Boolean);
  // Keep user-entered targets unchanged during catalog reconciliation. Availability and
  // mandatory conflicts are validation states, not reasons to silently rewrite preferences.
  void totalCredits;
  return { ...preferences, mandatoryCourses: Array.from(new Set(mandatoryCourses)), mandatoryCourseKeys: uniqueMandatoryKeys };
}
