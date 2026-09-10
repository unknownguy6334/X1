import { OptimizationResult, DayOfWeek } from '../types';

export const DAY_ORDER: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const DAY_FULL_NAMES: Record<DayOfWeek, string> = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

const DAY_TO_ICS_DAY: Record<string, string> = {
  SUN: 'SU',
  MON: 'MO',
  TUE: 'TU',
  WED: 'WE',
  THU: 'TH',
  FRI: 'FR',
  SAT: 'SA',
};

// Next upcoming date matching a DayOfWeek to anchor recurring iCal events
function getNextDayDate(day: string): Date {
  const targetDayIdx = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(day);
  const now = new Date();
  const currentDayIdx = now.getDay();
  let distance = targetDayIdx - currentDayIdx;
  if (distance <= 0) distance += 7;
  const result = new Date(now);
  result.setDate(now.getDate() + distance);
  return result;
}

function formatDateToICS(date: Date, timeStr: string): string {
  const [hours, mins] = timeStr.split(':').map((n) => parseInt(n, 10) || 0);
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const hh = hours.toString().padStart(2, '0');
  const mm = mins.toString().padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}00`;
}

// Best-effort IANA timezone of the device generating the export. Anchoring events to
// this zone (via a TZID parameter) instead of emitting a bare floating time means a
// calendar app opened in a *different* device timezone will still show the class at
// the correct local time it was scheduled in, rather than shifting every event by the
// viewer's UTC offset difference.
function getIcsTimezoneId(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && typeof zone === 'string') return zone;
  } catch {
    // Intl was unavailable or the time zone could not be read. Use UTC instead.
  }
  return 'UTC';
}

function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function parseExportTime(timeStr: string): { hours: number; minutes: number } | null {
  const normalized = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!/^\d{2}:\d{2}$/.test(normalized)) return null;
  const [hours, minutes] = normalized.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function assertExportableSchedule(schedule: OptimizationResult): void {
  if (!schedule || !Array.isArray(schedule.sections) || schedule.sections.length === 0) {
    throw new Error('Cannot export an empty or invalid schedule.');
  }
  for (const section of schedule.sections) {
    if (!section || typeof section.name !== 'string' || !Array.isArray(section.sessions) || section.sessions.length === 0) {
      throw new Error('Cannot export a schedule containing an invalid course section.');
    }
    for (const session of section.sessions) {
      if (!DAY_ORDER.includes(session.day)) throw new Error(`Cannot export invalid class day: ${String(session.day)}.`);
      const start = parseExportTime(session.start);
      const end = parseExportTime(session.end);
      if (!start || !end || start.hours * 60 + start.minutes >= end.hours * 60 + end.minutes) {
        throw new Error(`Cannot export invalid class time for ${section.name}.`);
      }
    }
  }
}

export function generateICS(schedule: OptimizationResult, optionIndex: number = 1): string {
  assertExportableSchedule(schedule);
  const tzid = getIcsTimezoneId();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gadwal Course Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Optimized Schedule Option ${optionIndex}`,
    `X-WR-TIMEZONE:${tzid}`,
  ];

  for (const section of schedule.sections) {
    section.sessions.forEach((session, sessionIdx) => {
      const anchorDate = getNextDayDate(session.day);
      const dtStart = formatDateToICS(anchorDate, session.start);
      const dtEnd = formatDateToICS(anchorDate, session.end);
      const icsDay = DAY_TO_ICS_DAY[session.day] || 'MO';

      const visibleSectionCode = section.sectionCode?.trim() || 'Course code missing';
      const summaryText = escapeIcsText(`${section.name} (${visibleSectionCode})`);
      const descText = escapeIcsText(
        `Course: ${section.name}\nSection: ${visibleSectionCode}\nCredits: ${section.credits ?? 'Unknown'}${section.instructor ? `\nInstructor: ${section.instructor}` : ''}`
      );

      lines.push(
        'BEGIN:VEVENT',
        // UID is intentionally based on section + day + the session's position within
        // the section (not the time itself), so that re-exporting after editing a
        // session's time updates the SAME calendar event instead of minting a new UID
        // and leaving the old time-slot as an orphaned duplicate that nothing cancels.
        `UID:${escapeIcsText(`${section.name}-${section.id}-${session.day}-${sessionIdx}`)}@gadwal.scheduler`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
        `SEQUENCE:0`,
        `SUMMARY:${summaryText}`,
        `DESCRIPTION:${descText}`,
        `DTSTART;TZID=${tzid}:${dtStart}`,
        `DTEND;TZID=${tzid}:${dtEnd}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${icsDay};COUNT=16`,
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(schedule: OptimizationResult, optionIndex: number = 1) {
  const content = generateICS(schedule, optionIndex);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Gadwal-Schedule-${optionIndex}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadSingleScheduleIcs = downloadICS;

