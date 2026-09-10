import { DayOfWeek, OptimizationResult, Section, Session } from '../types';
import { timeToMinutes } from './optimizer';
import { formatCourseDisplay } from './courseUtils';

export const RESULT_DAY_ORDER: DayOfWeek[] = ['SAT','SUN','MON','TUE','WED','THU','FRI'];
export const RESULT_DAY_FULL_NAMES: Record<DayOfWeek,string> = {SAT:'Saturday',SUN:'Sunday',MON:'Monday',TUE:'Tuesday',WED:'Wednesday',THU:'Thursday',FRI:'Friday'};

export interface ScheduleDaySession {
  section: Section;
  session: Session;
  startMinutes: number;
  endMinutes: number;
  gapBeforeMinutes: number;
  displayCourse: string;
}

/** One canonical day/session mapping for result rendering and downstream presentation. */
export function getSortedScheduleDaySessions(schedule: OptimizationResult): Record<DayOfWeek, ScheduleDaySession[]> {
  const grouped: Record<DayOfWeek, ScheduleDaySession[]> = {
    SAT: [], SUN: [], MON: [], TUE: [], WED: [], THU: [], FRI: [],
  };
  for (const section of schedule.sections || []) {
    for (const session of section.sessions || []) {
      if (!grouped[session.day]) continue;
      const startMinutes = timeToMinutes(session.start);
      const endMinutes = timeToMinutes(session.end);
      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) continue;
      grouped[session.day].push({
        section,
        session,
        startMinutes,
        endMinutes,
        gapBeforeMinutes: 0,
        displayCourse: formatCourseDisplay(section.courseCode, section.name),
      });
    }
  }
  for (const day of RESULT_DAY_ORDER) {
    grouped[day].sort((a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      a.displayCourse.localeCompare(b.displayCourse) ||
      (a.section.sectionCode || '').localeCompare(b.section.sectionCode || '') ||
      (a.section.id || '').localeCompare(b.section.id || '')
    );
    let previousEnd = -Infinity;
    for (const item of grouped[day]) {
      item.gapBeforeMinutes = Number.isFinite(previousEnd) ? Math.max(0, item.startMinutes - previousEnd) : 0;
      previousEnd = Math.max(previousEnd, item.endMinutes);
    }
  }
  return grouped;
}

export function getCourseCreditSummary(sections: Section[]) {
  const groups = new Map<string, { known: Set<number>; unknown: boolean }>();
  for (const section of sections || []) {
    const key = section.courseKey || `${section.courseCode || ''}::${section.name || ''}`;
    const entry = groups.get(key) || { known: new Set<number>(), unknown: false };
    if (section.credits == null || !Number.isFinite(section.credits)) entry.unknown = true;
    else entry.known.add(section.credits);
    groups.set(key, entry);
  }
  let knownCredits = 0;
  let unknownCourses = 0;
  let conflictingCourses = 0;
  for (const value of groups.values()) {
    if (value.known.size === 1 && !value.unknown) knownCredits += [...value.known][0];
    else if (value.known.size > 1) { conflictingCourses++; unknownCourses++; }
    else if (value.unknown) unknownCourses++;
  }
  return { knownCredits, unknownCourses, conflictingCourses, courseCount: groups.size };
}

export function getRankingSummary(
  schedule: OptimizationResult,
  previous: OptimizationResult | undefined,
  preferences: { preferCompactDays?: boolean },
): string {
  if (schedule.isTie) return 'Tied with another schedule on the active ranking criteria';
  const reasons: string[] = [];
  if (!previous) return `Ranks highly with ${schedule.totalGap} minutes of gap time across ${schedule.numDays} ${schedule.numDays === 1 ? 'day' : 'days'}`;
  if (schedule.totalGap < previous.totalGap) reasons.push('less gap time');
  if (schedule.totalGap === previous.totalGap && schedule.numDays < previous.numDays) reasons.push('fewer campus days');
  if (preferences.preferCompactDays && schedule.totalGap === previous.totalGap && schedule.numDays === previous.numDays) reasons.push('more compact daily span');
  return reasons.length ? `Ranks ahead because it has ${reasons.join(' and ')}` : 'Same visible ranking score; final order is deterministic';
}

export function formatGapLabel(totalGapMinutes: number): string {
  if (!Number.isFinite(totalGapMinutes) || totalGapMinutes <= 0) return 'No gaps';
  const hours = Math.floor(totalGapMinutes / 60);
  const minutes = totalGapMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m total gaps`;
  if (hours) return `${hours}h total gaps`;
  return `${minutes}m total gaps`;
}

export function getScheduleTheme(rank: number) {
  if (rank === 1) return { badge: 'bg-accent text-white', border: 'border-accent-line', dot: 'bg-accent', toggleBtn: 'bg-accent-soft text-accent-strong hover:bg-accent-soft border-accent-line', accentText: 'text-accent-strong' };
  if (rank === 2) return { badge: 'bg-ink-soft text-white', border: 'border-line-strong', dot: 'bg-ink-soft', toggleBtn: 'bg-mist text-ink hover:bg-line border-line-strong', accentText: 'text-ink' };
  if (rank === 3) return { badge: 'bg-caution text-white', border: 'border-caution-line', dot: 'bg-caution', toggleBtn: 'bg-caution-soft text-caution-strong hover:bg-caution-soft border-caution-line', accentText: 'text-caution-strong' };
  return { badge: 'bg-ink text-white', border: 'border-line', dot: 'bg-ink', toggleBtn: 'bg-mist text-ink hover:bg-line border-line', accentText: 'text-ink' };
}

export function formatGapTime(totalGapMinutes: number): { hoursStr: string; minutesStr: string } {
  if (!Number.isFinite(totalGapMinutes) || totalGapMinutes <= 0) return { hoursStr: '0 HOURS', minutesStr: '(0 MINUTES)' };
  const hours = totalGapMinutes / 60;
  const hoursVal = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
  const hoursUnit = hoursVal === 1 ? 'HOUR' : 'HOURS';
  return { hoursStr: `${hoursVal} ${hoursUnit}`, minutesStr: `(${totalGapMinutes} MINUTES)` };
}
