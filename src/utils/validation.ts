/** Centralized runtime validation/sanitization helpers for user and recovered data. */

export const MAX_COURSE_NAME_LENGTH = 160;
export const MAX_SECTION_ID_LENGTH = 80;
export const MAX_INSTRUCTOR_LENGTH = 160;

export function parseCreditHours(value: unknown, options: { allowEmpty?: boolean } = {}): number | null {
  if (value === null || value === undefined || value === '') return options.allowEmpty ? null : null;
  const raw = String(value).trim();
  if (!raw) return options.allowEmpty ? null : null;
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

export function sanitizeBoundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}
