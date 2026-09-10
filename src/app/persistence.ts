import { OptimizationResult, OptimizerOutput, SchedulePreferences, Section } from '../types';
import { timeToMinutes } from '../utils/optimizer';
import { getScheduleSignature } from '../utils/courseUtils';
import { safeStorage, parseStorageEnvelope } from '../utils/safeStorage';
import { sanitizeSections, sanitizeSectionsSnapshot, sanitizePreferencesSnapshot } from '../utils/persistenceValidation';
import { STORAGE_KEYS } from './persistenceKeys';

export const STORAGE_KEY_SECTIONS = STORAGE_KEYS.sections;
export const STORAGE_KEY_PREFS = STORAGE_KEYS.preferences;
export const STORAGE_KEY_OPTIMIZER = STORAGE_KEYS.optimizer;
export const STORAGE_KEY_SCHEMA_VERSION = STORAGE_KEYS.schemaVersion;
export const STORAGE_KEY_CURRENT_STEP = STORAGE_KEYS.currentStep;
export const STORAGE_KEY_FAVORITES = STORAGE_KEYS.favorites;
export const STORAGE_KEY_ACTIVE_TAB = STORAGE_KEYS.activeTab;
export const CURRENT_SCHEMA_VERSION = 'v4.2';
export const CURRENT_RESULT_CONTRACT_VERSION = 'v3';
export const SUPPORTED_SCHEMA_VERSIONS = new Set(['v4.1', CURRENT_SCHEMA_VERSION]);
export const SUPPORTED_RESULT_CONTRACT_VERSIONS = new Set(['v2', CURRENT_RESULT_CONTRACT_VERSION]);
export const LEGACY_STORAGE_KEY_SECTIONS = 'register_course_sections_v4';
export const LEGACY_STORAGE_KEY_PREFS = 'register_schedule_preferences_v4';
export const DEFAULT_PREFERENCES: SchedulePreferences = { targetCredits: null, dayBuckets: [1,2,3,4,5,6,7], targetCourseCount: null, mandatoryCourses: [], mandatoryCourseKeys: [], useCreditRange: false, minCredits: undefined, maxCredits: undefined, earliestStartTime: 'ANY', latestEndTime: 'ANY', freeDays: [], maxDays: null, preferCompactDays: false };


export function clearAllPersistedAppData(): void {
  const localKeys = [
    STORAGE_KEY_SECTIONS, STORAGE_KEY_PREFS, STORAGE_KEY_OPTIMIZER,
    STORAGE_KEY_CURRENT_STEP, STORAGE_KEY_SCHEMA_VERSION, STORAGE_KEY_FAVORITES,
    LEGACY_STORAGE_KEY_SECTIONS, LEGACY_STORAGE_KEY_PREFS,
    STORAGE_KEY_ACTIVE_TAB,
    'gadwal_pending_review_v4', 'gadwal_pending_review_v1', 'gadwal_pending_review_v2', 'gadwal_pending_review_v3',
    'gadwal_manual_forms_v1', 'gadwal_test_font',
  ];
  localKeys.forEach((key) => safeStorage.removeItem(key));
  ['gadwal_pending_review_v4','gadwal_pending_review_v1','gadwal_pending_review_v2','gadwal_pending_review_v3','gadwal_manual_forms_v1', STORAGE_KEY_ACTIVE_TAB]
    .forEach((key) => safeStorage.sessionRemoveItem(key));
}

export function sanitizeOptimizerOutput(value: unknown): OptimizerOutput | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<OptimizerOutput> & Record<string, unknown>;
  if (!parsed.byDayCount || typeof parsed.byDayCount !== 'object') return null;

  const byDayCount: Record<number, OptimizationResult[]> = {};
  const allSanitizedSchedules: OptimizationResult[] = [];

  const computeScheduleMetrics = (scheduleSections: Section[]) => {
    const daySet = new Set<'SAT' | 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI'>();
    const daySessions: Record<string, Array<{ start: number; end: number }>> = {};
    let totalCredits = 0;
    let earliestStartMinutes = 24 * 60;
    let latestEndMinutes = 0;

    for (const section of scheduleSections) {
      totalCredits += section.credits ?? 0;
      for (const session of section.sessions) {
        const start = timeToMinutes(session.start);
        const end = timeToMinutes(session.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
        daySet.add(session.day);
        (daySessions[session.day] ||= []).push({ start, end });
        earliestStartMinutes = Math.min(earliestStartMinutes, start);
        latestEndMinutes = Math.max(latestEndMinutes, end);
      }
    }

    let totalGap = 0;
    for (const sessions of Object.values(daySessions)) {
      sessions.sort((a, b) => a.start - b.start);
      for (let i = 1; i < sessions.length; i++) {
        totalGap += Math.max(0, sessions[i].start - sessions[i - 1].end);
      }
    }

    const days = Array.from(daySet);
    days.sort((a, b) => ['SAT','SUN','MON','TUE','WED','THU','FRI'].indexOf(a) - ['SAT','SUN','MON','TUE','WED','THU','FRI'].indexOf(b));

    return {
      days,
      numDays: days.length,
      totalGap,
      totalCredits,
      earliestStartMinutes: earliestStartMinutes === 24 * 60 ? 0 : earliestStartMinutes,
      latestEndMinutes,
    };
  };

  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const list = Array.isArray(parsed.byDayCount[day]) ? parsed.byDayCount[day] : [];
    for (const schedule of list) {
      if (!schedule || typeof schedule !== 'object' || !Array.isArray(schedule.sections)) continue;
      // A stored result is accepted only when every stored section survives validation.
      // Never silently turn a malformed schedule into a partial schedule.
      const sanitizedSections: Section[] = [];
      let valid = true;
      for (const rawSection of schedule.sections) {
        if (!rawSection || typeof rawSection !== 'object') { valid = false; break; }
        const one = sanitizeSections([rawSection]);
        if (one.length !== 1) { valid = false; break; }
        sanitizedSections.push(one[0]);
      }
      if (!valid || sanitizedSections.length === 0) continue;

      const metrics = computeScheduleMetrics(sanitizedSections);
      if (!metrics || metrics.numDays < 1 || metrics.numDays > 7) continue;

      allSanitizedSchedules.push({
        ...schedule,
        sections: sanitizedSections,
        ...metrics,
      });
    }
  }

  // Persisted/legacy output can contain duplicate IDs or duplicate schedules.
  // Use the exact same canonical schedule signature as the live optimizer so
  // custom meeting labels and other identity fields cannot drift between layers.
  const seenSignatures = new Set<string>();
  const canonicalSchedules: OptimizationResult[] = [];
  for (const schedule of allSanitizedSchedules) {
    const signature = getScheduleSignature(schedule);
    if (!signature || seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    canonicalSchedules.push({ ...schedule, id: `sch-${canonicalSchedules.length + 1}` });
  }

  for (const day of [1, 2, 3, 4, 5, 6, 7]) byDayCount[day] = [];
  for (const schedule of canonicalSchedules) {
    byDayCount[schedule.numDays].push(schedule);
  }

  const searchCompleteness = ['exhaustive', 'sampled', 'capped', 'cancelled', 'not_searched', 'preflight_rejected'].includes(parsed.searchCompleteness)
    ? parsed.searchCompleteness
    : undefined;

  return {
    ...parsed,
    signatureStatus: parsed.generatedInputsSignature && parsed.resultContractVersion === CURRENT_RESULT_CONTRACT_VERSION && parsed.sectionsSnapshotComplete === true && parsed.preferencesSnapshotComplete === true ? 'verified' : 'unknown',
    resultContractVersion: typeof parsed.resultContractVersion === 'string' && SUPPORTED_RESULT_CONTRACT_VERSIONS.has(parsed.resultContractVersion) ? parsed.resultContractVersion as 'v2' | 'v3' : undefined,
    searchCompleteness,
    byDayCount,
    totalFoundByDay: (() => {
      const rawCounts = parsed.totalFoundByDay && typeof parsed.totalFoundByDay === 'object' ? parsed.totalFoundByDay as Record<string, unknown> : {};
      const counts: Record<number, number> = {};
      for (const d of [1,2,3,4,5,6,7]) counts[d] = Number.isInteger(rawCounts[String(d)]) && Number(rawCounts[String(d)]) >= byDayCount[d].length ? Number(rawCounts[String(d)]) : byDayCount[d].length;
      return counts;
    })(),
    sectionsSnapshot: Array.isArray(parsed.sectionsSnapshot) ? sanitizeSections(parsed.sectionsSnapshot) : undefined,
    sectionsSnapshotComplete: parsed.sectionsSnapshotComplete === true && Array.isArray(parsed.sectionsSnapshot),
    preferencesSnapshotComplete: parsed.preferencesSnapshotComplete === true && Boolean(parsed.preferencesUsed),
    allSectionsConsidered: Array.isArray(parsed.allSectionsConsidered) ? sanitizeSections(parsed.allSectionsConsidered) : [],
  } as OptimizerOutput;
}

export function readSnapshot<T>(raw: string | null, options?: { allowLegacyRaw?: boolean }): { data: T; updatedAt: number; schemaVersion: string } | null {
  if (!raw) return null;
  const envelope = parseStorageEnvelope<T>(raw);
  if (envelope) return envelope;
  try {
    if (!options?.allowLegacyRaw) return null;
    return { data: JSON.parse(raw) as T, updatedAt: 0, schemaVersion: 'legacy-raw' };
  } catch {
    return null;
  }
}

export function readSavedOptimizerOutput(): OptimizerOutput | null {
  try {
    const snapshot = readSnapshot<unknown>(safeStorage.getItem(STORAGE_KEY_OPTIMIZER));
    if (!snapshot || !SUPPORTED_SCHEMA_VERSIONS.has(snapshot.schemaVersion)) return null;
    return sanitizeOptimizerOutput(snapshot.data);
  } catch {
    return null;
  }
}

interface PersistedCandidate<T> { key: string; data: T; updatedAt: number; schemaVersion: string; }

function readCandidate<T>(key: string, sanitize: (value: unknown) => T | null, allowLegacyRaw = false): PersistedCandidate<T> | null {
  const raw = safeStorage.getItem(key);
  const env = readSnapshot<unknown>(raw, { allowLegacyRaw });
  if (!env || !SUPPORTED_SCHEMA_VERSIONS.has(env.schemaVersion)) return null;
  const data = sanitize(env.data);
  return data === null ? null : { key, data, updatedAt: env.updatedAt, schemaVersion: env.schemaVersion };
}

export function migrateSnapshot<T>(currentKey: string, legacyKeys: string[], sanitize: (value: unknown) => T | null): T | null {
  const current = readCandidate(currentKey, sanitize, false);
  if (current) return current.data;
  for (const legacyKey of legacyKeys) {
    const raw = safeStorage.getItem(legacyKey);
    const env = readSnapshot<unknown>(raw, { allowLegacyRaw: true });
    if (!env || env.schemaVersion !== 'legacy-raw') continue;
    const data = sanitize(env.data);
    if (data === null) continue;
    const wrapped = JSON.stringify(createStorageEnvelope(data, CURRENT_SCHEMA_VERSION));
    if (safeStorage.setItemVerified(currentKey, wrapped)) safeStorage.removeItem(legacyKey);
    return data;
  }
  return null;
}

export function readSavedSections(): Section[] {
  return migrateSnapshot(STORAGE_KEY_SECTIONS, [LEGACY_STORAGE_KEY_SECTIONS], sanitizeSectionsSnapshot) || [];
}

export function readSavedPreferences(): SchedulePreferences {
  return migrateSnapshot(STORAGE_KEY_PREFS, [LEGACY_STORAGE_KEY_PREFS], sanitizePreferencesSnapshot) || DEFAULT_PREFERENCES;
}

export function readSavedCurrentStep(): string | null {
  const value = safeStorage.getItem(STORAGE_KEY_CURRENT_STEP);
  return value === 'home' || value === 'setup' || value === 'results' ? value : null;
}

export function saveCurrentStep(step: 'home' | 'setup' | 'results'): boolean {
  return safeStorage.setItem(STORAGE_KEY_CURRENT_STEP, step);
}

export function readFavoriteSignatures(): string[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY_FAVORITES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 500) : [];
  } catch { return []; }
}

export function saveFavoriteSignatures(signatures: string[]): boolean {
  return safeStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(Array.from(new Set(signatures)).slice(0, 500)));
}

export function normalizePathname(rawPathname: string): string {
  return rawPathname.length > 1 && rawPathname.endsWith('/')
    ? rawPathname.slice(0, -1)
    : rawPathname;
}

