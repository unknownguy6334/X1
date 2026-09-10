import type { Section, Session } from '../types';

export function normalizeCourseCode(value: string | null | undefined): string {
  return String(value ?? '').trim().normalize('NFKC').toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]+/gu, '');
}

export function normalizeCourseName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[.,:;]+|[.,:;]+$/g, '')
    .trim();
}

export function buildCourseKey(courseCode: string | null | undefined, courseName: string | null | undefined): string {
  const code = normalizeCourseCode(courseCode);
  if (code) return `CODE:${code}`;
  return `NAME:${normalizeCourseName(courseName)}`;
}

export function getCourseIdentityKey(courseCode: string | null | undefined, courseName: string | null | undefined): string {
  return buildCourseKey(courseCode, courseName).toLowerCase();
}

export function canonicalCourseKey(section: Pick<Section, 'courseKey' | 'courseCode' | 'name'>): string {
  return section.courseKey?.trim() || getCourseIdentityKey(section.courseCode, section.name);
}

export function normalizeSectionCode(value: string | null | undefined): string {
  return String(value ?? '').trim().normalize('NFKC').toUpperCase().replace(/\s+/g, ' ');
}

export function canonicalSectionKey(section: Pick<Section, 'id' | 'sectionCode' | 'canonicalSectionKey' | 'name' | 'courseCode'>): string {
  if (section.canonicalSectionKey?.trim()) return section.canonicalSectionKey.trim().toUpperCase();
  const course = buildCourseKey(section.courseCode, section.name);
  const code = normalizeSectionCode(section.sectionCode);
  return `${course}::SECTION:${code || String(section.id ?? '').trim().toUpperCase()}`;
}

export function canonicalMeetingKey(session: Session): string {
  const type = String(session.type ?? 'Other').trim().toLowerCase();
  const custom = type === 'custom' ? String(session.customType ?? '').trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return [String(session.day).trim().toUpperCase(), String(session.start).trim(), String(session.end).trim(), type, custom].join('|');
}

export function canonicalRawMeetingFingerprint(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.map((key) => `${key}=${String(record[key] ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`).join('|');
}

export function canonicalSectionFingerprint(section: Section): string {
  return JSON.stringify({
    courseKey: canonicalCourseKey(section),
    sectionKey: canonicalSectionKey(section),
    sectionCode: normalizeSectionCode(section.sectionCode),
    credits: section.credits,
    creditConflict: Array.isArray(section.creditHoursConflict) ? [...section.creditHoursConflict].sort((a, b) => a - b) : [],
    sessions: (section.sessions || []).map(canonicalMeetingKey).sort(),
    reviewReasons: [...(section.reviewReasons || [])].map(String).sort(),
    sourceImageIndexes: [...(section.sourceImageIndexes || [])].sort((a, b) => a - b),
    workflowGenerationId: section.workflowGenerationId || '',
    ocrRunId: section.ocrRunId || '',
  });
}
