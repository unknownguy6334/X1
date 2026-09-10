import type { Section, Session } from '../types';
import { MANUAL_MEETING_TYPE_OPTIONS } from '../utils/meetingTypes';
import { buildCourseKey, canonicalSectionKey } from './identity';
import { isManualMeetingType } from './meeting';

export interface SectionValidationIssue { field: string; message: string; blocking: boolean; }

export function validateSession(session: Session): SectionValidationIssue[] {
  const issues: SectionValidationIssue[] = [];
  if (!session.day) issues.push({ field: 'day', message: 'Choose a meeting day.', blocking: true });
  if (!/^\d{2}:\d{2}$/.test(session.start) || !/^\d{2}:\d{2}$/.test(session.end)) issues.push({ field: 'time', message: 'Enter valid start and end times.', blocking: true });
  if (session.type === 'Custom' && !String(session.customType ?? '').trim()) issues.push({ field: 'customType', message: 'Enter a name for this custom meeting type.', blocking: true });
  return issues;
}

export function validateSection(section: Section): SectionValidationIssue[] {
  const issues: SectionValidationIssue[] = [];
  if (!section.name.trim()) issues.push({ field: 'name', message: 'Course name is required.', blocking: true });
  if (!String(section.courseCode ?? '').trim()) issues.push({ field: 'courseCode', message: 'Course code is required.', blocking: true });
  if (!String(section.sectionCode ?? '').trim()) issues.push({ field: 'sectionCode', message: 'Section code is required.', blocking: true });
  if (!section.sessions.length) issues.push({ field: 'sessions', message: 'Add at least one meeting.', blocking: true });
  for (const session of section.sessions) issues.push(...validateSession(session));
  return issues;
}

export function isValidManualMeetingType(value: unknown): boolean {
  return isManualMeetingType(value) && (MANUAL_MEETING_TYPE_OPTIONS as readonly string[]).includes(value);
}

export function wouldCollideWithSection(existing: Section[], candidate: Section, excludedIds = new Set<string>()): boolean {
  const candidateCourse = candidate.courseKey || buildCourseKey(candidate.courseCode, candidate.name);
  const candidateKey = canonicalSectionKey(candidate);
  return existing.some((section) => {
    if (excludedIds.has(section.id)) return false;
    if ((section.courseKey || buildCourseKey(section.courseCode, section.name)) !== candidateCourse) return false;
    return canonicalSectionKey(section) === candidateKey;
  });
}
