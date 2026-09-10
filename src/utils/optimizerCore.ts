import { DayOfWeek, OptimizationResult, Session } from '../types';
import { parseTimeToMinutes } from '../domain/time';
import { resolveDayTokens } from './scheduleParsing';

export const ALL_DAYS: DayOfWeek[] = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
export const DAYS: DayOfWeek[] = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

/**
 * Daily span is the maximum occupied span of any single campus day.
 * Ranking itself lives in optimizer.ts so user preferences and tie semantics are shared.
 */
export function getScheduleDailySpanMinutes(schedule: OptimizationResult): number {
  if (!schedule || !Array.isArray(schedule.sections)) return Number.POSITIVE_INFINITY;
  const bounds: Partial<Record<DayOfWeek, { start: number; end: number }>> = {};
  for (const section of schedule.sections) {
    for (const session of section.sessions || []) {
      const day = normalizeDay(session.day);
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
      const current = bounds[day];
      if (!current) bounds[day] = { start, end };
      else {
        current.start = Math.min(current.start, start);
        current.end = Math.max(current.end, end);
      }
    }
  }
  let maxSpan = 0;
  for (const bound of Object.values(bounds)) {
    if (bound) maxSpan = Math.max(maxSpan, bound.end - bound.start);
  }
  return maxSpan;
}

function compareFinite(a: number, b: number): number {
  const aFinite = Number.isFinite(a);
  const bFinite = Number.isFinite(b);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return a - b;
}

export function compareSchedules(a: OptimizationResult, b: OptimizationResult): number {
  // Base comparator: least total gap first. Higher-level preference ranking adds
  // the explicit campus-day/compactness priorities before declaring a tie.
  return a.totalGap - b.totalGap;
}


/**
 * Normalizes day strings into standard DayOfWeek format ('SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI')
 */
export function normalizeDay(dayStr: string): DayOfWeek | null {
  if (!dayStr) return null;
  return resolveDayTokens(dayStr)[0] ?? null;
}


/**
 * Robustly parses any time string into absolute minutes from midnight (0 to 1439).
 * Supports:
 * - 12h AM/PM formats: "1:00 PM", "1:00PM", "8:30 AM", "12:00 PM", "12:30 AM"
 * - 24h formats: "13:00", "08:30", "16:30", "18:00", "00:30"
 * - Numeric/string variations
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return Number.NaN;
  // Time values entering optimizer validation are expected to be normalized.
  // The shared policy is still used defensively so raw/corrupt values cannot
  // acquire a fourth interpretation of AM/PM.
  const minutes = parseTimeToMinutes(timeStr);
  if (minutes === null) return Number.NaN;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!Number.isInteger(h) || !Number.isInteger(m)) return Number.NaN;
  return h * 60 + m;
}

export function formatMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '0h 00m (0 mins gap)';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m (${totalMinutes} mins)`;
  return `${hours}h ${mins.toString().padStart(2, '0')}m (${totalMinutes} mins)`;
}

export function formatTime12(timeStr: string | number): string {
  if (typeof timeStr === 'number') {
    const h24 = Math.floor(timeStr / 60) % 24;
    const m = timeStr % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
  const mins = timeToMinutes(timeStr);
  if (!Number.isFinite(mins)) return timeStr;
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export interface SessionConflictDetail {
  sessionA?: Session;
  sessionB?: Session;
  reason: 'overlap' | 'invalid_session';
}

function validateSession(session: Session): { day: DayOfWeek; start: number; end: number } | null {
  const day = normalizeDay(session.day);
  const start = timeToMinutes(session.start);
  const end = timeToMinutes(session.end);
  if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  return { day, start, end };
}

export function findSessionConflict(sessionsA: Session[], sessionsB: Session[]): SessionConflictDetail | null {
  for (const a of sessionsA || []) {
    const parsedA = validateSession(a);
    if (!parsedA) return { sessionA: a, reason: 'invalid_session' };
    for (const b of sessionsB || []) {
      const parsedB = validateSession(b);
      if (!parsedB) return { sessionA: a, sessionB: b, reason: 'invalid_session' };
      if (parsedA.day === parsedB.day && parsedA.start < parsedB.end && parsedB.start < parsedA.end) {
        return { sessionA: a, sessionB: b, reason: 'overlap' };
      }
    }
  }
  return null;
}

export function conflicts(sessionsA: Session[], sessionsB: Session[]): boolean {
  return findSessionConflict(sessionsA, sessionsB) !== null;
}

export const sessionsConflict = conflicts;

// Check if sessions within the same section overlap with each other
export function hasInternalConflict(sessions: Session[]): boolean {
  if (!Array.isArray(sessions) || sessions.length === 0) return false;
  for (let i = 0; i < sessions.length; i++) {
    if (!validateSession(sessions[i])) return true;
    for (let j = i + 1; j < sessions.length; j++) {
      if (!validateSession(sessions[j])) return true;
      if (conflicts([sessions[i]], [sessions[j]])) return true;
    }
  }
  return false;
}

