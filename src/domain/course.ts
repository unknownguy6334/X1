import type { CourseGroup, Section } from '../types';
import { buildCourseKey, canonicalCourseKey, canonicalSectionKey, normalizeCourseCode, normalizeCourseName, normalizeSectionCode } from './identity';

export interface CourseIdentity {
  courseKey: string;
  courseCode: string | null;
  courseName: string;
}

export function getCourseIdentity(section: Pick<Section, 'courseKey' | 'courseCode' | 'name'>): CourseIdentity {
  return {
    courseKey: canonicalCourseKey(section),
    courseCode: typeof section.courseCode === 'string' && section.courseCode.trim() ? normalizeCourseCode(section.courseCode) : null,
    courseName: String(section.name || '').trim(),
  };
}

export function getDistinctCourseCount(sections: Section[]): number {
  return new Set(sections.map((section) => getCourseIdentity(section).courseKey.toLowerCase())).size;
}

export function buildCourseGroups(sections: Section[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>();
  for (const section of sections) {
    const identity = getCourseIdentity(section);
    const existing = groups.get(identity.courseKey);
    if (existing) existing.sections.push(section);
    else groups.set(identity.courseKey, { name: identity.courseName, sections: [section] });
  }
  return Array.from(groups.values());
}

export function canonicalSectionIdentity(section: Pick<Section, 'id' | 'sectionCode' | 'canonicalSectionKey' | 'name' | 'courseCode'>): string {
  return canonicalSectionKey(section).toLowerCase();
}

export interface SectionUpdateSummary {
  identityChanged: boolean;
  courseIdentityChanged: boolean;
  sectionIdentityChanged: boolean;
  scheduleChanged: boolean;
  creditsChanged: boolean;
  fieldsChanged: string[];
}

function meetingSemanticKey(section: Section): string {
  return (section.sessions || []).map((session) => [
    session.day,
    session.start,
    session.end,
    session.type,
    session.customType || '',
  ].join('|')).sort().join(';;');
}

export function updateSection(
  sections: Section[],
  originalId: string,
  updatedSection: Section,
  options: { originalCourseName?: string; originalCourseKey?: string; originalSectionKey?: string } = {},
): { sections: Section[]; summary: SectionUpdateSummary; accepted: boolean } {
  const originalName = options.originalCourseName ? normalizeCourseName(options.originalCourseName) : null;
  const original = sections.find((section) =>
    section.id === originalId &&
    (!originalName || normalizeCourseName(section.name) === originalName) &&
    (!options.originalCourseKey || canonicalCourseKey(section) === options.originalCourseKey) &&
    (!options.originalSectionKey || canonicalSectionIdentity(section) === String(options.originalSectionKey).trim().toLowerCase() || normalizeSectionCode(section.sectionCode).toLowerCase() === normalizeSectionCode(String(options.originalSectionKey)).toLowerCase())
  );
  if (!original) return { sections, accepted: false, summary: { identityChanged: false, courseIdentityChanged: false, sectionIdentityChanged: false, scheduleChanged: false, creditsChanged: false, fieldsChanged: [] } };

  const originalCourseKey = canonicalCourseKey(original);
  const nextCourseKey = canonicalCourseKey(updatedSection);
  if (nextCourseKey !== originalCourseKey && sections.some((section) => section.id !== originalId && canonicalCourseKey(section) === nextCourseKey)) {
    return { sections, accepted: false, summary: { identityChanged: false, courseIdentityChanged: false, sectionIdentityChanged: false, scheduleChanged: false, creditsChanged: false, fieldsChanged: [] } };
  }

  const originalSectionKey = canonicalSectionIdentity(original);
  const nextSectionKey = canonicalSectionIdentity(updatedSection);
  if (nextSectionKey !== originalSectionKey && sections.some((section) => section.id !== originalId && canonicalSectionIdentity(section) === nextSectionKey)) {
    return { sections, accepted: false, summary: { identityChanged: false, courseIdentityChanged: false, sectionIdentityChanged: false, scheduleChanged: false, creditsChanged: false, fieldsChanged: [] } };
  }

  const fieldsChanged: string[] = [];
  if (normalizeCourseName(original.name) !== normalizeCourseName(updatedSection.name)) fieldsChanged.push('name');
  if (normalizeCourseCode(original.courseCode) !== normalizeCourseCode(updatedSection.courseCode)) fieldsChanged.push('courseCode');
  if (normalizeSectionCode(original.sectionCode) !== normalizeSectionCode(updatedSection.sectionCode)) fieldsChanged.push('sectionCode');
  if (original.credits !== updatedSection.credits) fieldsChanged.push('credits');
  if ((original.instructor || '') !== (updatedSection.instructor || '')) fieldsChanged.push('instructor');
  const scheduleChanged = meetingSemanticKey(original) !== meetingSemanticKey(updatedSection);
  if (scheduleChanged) fieldsChanged.push('sessions');

  const identityChanged = originalCourseKey !== nextCourseKey || originalSectionKey !== nextSectionKey;
  const result = sections.map((section) => {
    if (section.id === originalId) return { ...section, ...updatedSection, id: original.id };
    // Credits describe the same course across section siblings. Preserve this existing
    // product rule only when the course identity did not move.
    if (!identityChanged && original.credits !== updatedSection.credits && canonicalCourseKey(section) === originalCourseKey) {
      return { ...section, credits: updatedSection.credits };
    }
    return section;
  });

  return {
    sections: result,
    accepted: true,
    summary: {
      identityChanged,
      courseIdentityChanged: originalCourseKey !== nextCourseKey,
      sectionIdentityChanged: originalSectionKey !== nextSectionKey,
      scheduleChanged,
      creditsChanged: original.credits !== updatedSection.credits,
      fieldsChanged,
    },
  };
}

export { buildCourseKey, normalizeCourseCode, normalizeCourseName, normalizeSectionCode };
