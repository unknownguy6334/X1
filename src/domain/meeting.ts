import type { SessionType } from '../types';
import { MANUAL_MEETING_TYPE_OPTIONS, normalizeMeetingType } from '../utils/meetingTypes';

export type CanonicalSessionType = 'Lecture' | 'Section' | 'Lab' | 'Online' | 'Tutorial' | 'Discussion' | 'Recitation' | 'Seminar' | 'Workshop' | 'Other' | 'Custom';

export function isCanonicalSessionType(value: unknown): value is CanonicalSessionType {
  return typeof value === 'string' && ['Lecture','Section','Lab','Online','Tutorial','Discussion','Recitation','Seminar','Workshop','Other','Custom'].includes(value);
}

export function isManualMeetingType(value: unknown): value is (typeof MANUAL_MEETING_TYPE_OPTIONS)[number] {
  return typeof value === 'string' && (MANUAL_MEETING_TYPE_OPTIONS as readonly string[]).includes(value);
}

export function normalizeSessionType(value: unknown): { type: CanonicalSessionType; customType?: string } {
  const normalized = normalizeMeetingType(value);
  if (normalized.type === 'Custom') {
    const label = String(normalized.customType ?? '').trim().slice(0, 120);
    return label ? { type: 'Custom', customType: label } : { type: 'Other' };
  }
  return { type: normalized.type as CanonicalSessionType };
}

export function isTimedSessionType(_type: SessionType | undefined): boolean {
  // Gadwal currently requires a real day/time interval for every schedulable meeting.
  // Online/Custom therefore remain timed only when an actual day/time exists on the session.
  return true;
}
