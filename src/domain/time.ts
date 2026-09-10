import type { DayOfWeek } from '../types';
import { hasExplicitAmPm, isAmbiguousBareTime, normalizeTimeWithPolicy, parseTimeRangeWithPolicy } from '../utils/timeParsingPolicy';

export const DAY_ORDER: readonly DayOfWeek[] = ['SAT','SUN','MON','TUE','WED','THU','FRI'];
export const DAY_NAMES: Record<DayOfWeek, string> = { SAT: 'Saturday', SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday' };
const LEGACY_DAY_TOKENS: Record<string, DayOfWeek> = {
  SUN:'SUN', SUNDAY:'SUN', SU:'SUN', U:'SUN',
  MON:'MON', MONDAY:'MON', MO:'MON', M:'MON',
  TUE:'TUE', TUES:'TUE', TUESDAY:'TUE', TU:'TUE',
  WED:'WED', WEDNESDAY:'WED', WE:'WED',
  THU:'THU', THUR:'THU', THURS:'THU', THURSDAY:'THU', R:'THU', TH:'THU',
  FRI:'FRI', FRIDAY:'FRI', FR:'FRI', F:'FRI',
  SAT:'SAT', SATURDAY:'SAT', SA:'SAT',
};
export const DAY_TOKENS: Readonly<Record<string, DayOfWeek>> = LEGACY_DAY_TOKENS;

export function normalizeDay(value: string | null | undefined): DayOfWeek | null {
  const key = String(value ?? '').trim().toUpperCase().replace(/[.,]/g, '');
  return DAY_TOKENS[key] || (DAY_ORDER.includes(key as DayOfWeek) ? key as DayOfWeek : null);
}

export function normalizeMinutes(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 * 60 + 59 ? n : null;
}

export function timeToMinutes(raw: string | null | undefined): number {
  const value = String(raw ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const h = Number(match[1]); const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return NaN;
  return h * 60 + m;
}


export function parseTimeToMinutes(raw: string | null | undefined): number | null {
  const value = timeToMinutes(raw);
  return Number.isFinite(value) ? value : null;
}

export function minutesToTime(minutes: number): string {
  const n = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(n / 60)).padStart(2,'0')}:${String(n % 60).padStart(2,'0')}`;
}

export interface ParsedTime {
  minutes: number;
  normalized: string;
  ambiguous: boolean;
  source: string;
  explicitMeridiem: boolean;
}

function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** Single domain wrapper around the shared time parsing policy. */
export function parseCanonicalTime(raw: string, context: 'unknown' | 'am' | 'pm' = 'unknown', requireContextForBare = true): ParsedTime | null {
  const source = String(raw ?? '').trim();
  if (!source) return null;
  const normalizedSource = normalizeDigits(source);
  const normalized = normalizeTimeWithPolicy(normalizedSource, context === 'pm');
  if (!normalized) return null;
  const explicit = hasExplicitAmPm(normalizedSource);
  const bare = !explicit && context === 'unknown' && isAmbiguousBareTime(normalizedSource);
  if (requireContextForBare && bare && /^\d{1,2}$/.test(normalizedSource)) {
    return null;
  }
  const minutes = timeToMinutes(normalized);
  if (!Number.isFinite(minutes)) return null;
  return { minutes, normalized, ambiguous: bare, source, explicitMeridiem: explicit };
}

export function parseCanonicalTimeRange(raw: string): { start: ParsedTime; end: ParsedTime } | null {
  const policy = parseTimeRangeWithPolicy(String(raw ?? ''));
  if (!policy) return null;
  const start = parseCanonicalTime(policy.rawStart, policy.startPmContext ? 'pm' : 'unknown', true);
  const end = parseCanonicalTime(policy.rawEnd, policy.endPmContext ? 'pm' : 'unknown', true);
  if (!start || !end || end.minutes <= start.minutes) return null;
  return { start, end };
}
