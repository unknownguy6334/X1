import type { SessionType } from '../types';

export const NORMALIZED_MEETING_TYPES = [
  'Lecture',
  'Section',
  'Lab',
  'Tutorial',
  'Discussion',
  'Recitation',
  'Seminar',
  'Workshop',
  'Online',
  'Other',
] as const satisfies readonly SessionType[];

export type NormalizedMeetingType = typeof NORMALIZED_MEETING_TYPES[number];

export const REVIEW_MEETING_TYPE_OPTIONS: readonly string[] = NORMALIZED_MEETING_TYPES;
/** Meeting types exposed by the manual course-entry flow. Keep this separate
 * from the broader OCR/review vocabulary: manual entry has an explicit product
 * contract and must expose exactly these predefined options. */
export const MANUAL_MEETING_TYPE_OPTIONS = [
  'Lecture',
  'Section',
  'Lab',
  'Online',
  'Custom',
] as const;

export type ManualMeetingType = typeof MANUAL_MEETING_TYPE_OPTIONS[number];

/** Returns the user-facing label for a stored meeting. Custom meetings keep their
 * canonical type as 'Custom' and expose the entered label separately. */
export function getMeetingTypeLabel(type: string | undefined, customType?: string | null): string {
  if (type === 'Custom') return customType?.trim() || 'Custom';
  return type?.trim() || 'Meeting';
}


export function isNormalizedMeetingType(value: unknown): value is NormalizedMeetingType {
  return typeof value === 'string' && (NORMALIZED_MEETING_TYPES as readonly string[]).includes(value);
}


export function normalizeMeetingType(value: unknown): { type: NormalizedMeetingType | 'Custom'; customType?: string } {
  const raw = String(value ?? '').trim();
  const canonical = NORMALIZED_MEETING_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase());
  if (canonical) return { type: canonical };
  if (raw) return { type: 'Custom', customType: raw.slice(0, 120) };
  return { type: 'Other' };
}
