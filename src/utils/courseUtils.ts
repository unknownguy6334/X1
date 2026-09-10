import type { Section, OptimizationResult, SchedulePreferences, OptimizerOutput } from '../types';
import { buildCourseKey as domainBuildCourseKey, getCourseIdentityKey as domainGetCourseIdentityKey, normalizeCourseName as domainNormalizeCourseName, normalizeCourseCode, canonicalCourseKey, canonicalSectionKey, canonicalSectionFingerprint, canonicalRawMeetingFingerprint } from '../domain/identity';
import {
  canonicalizeDisplaySectionCode,
  canonicalizeSectionIdentity,
  classifySectionCodeRelation,
  consolidateDerivedCompositeSections,
  getCanonicalSectionKey,
  getResolvedSectionIdentity,
  mergeDuplicateCanonicalSections,
} from './courseCodeRelation';

/**
 * Normalizes course names for comparison and identity keys:
 * - Trims leading and trailing whitespace
 * - Converts to lower-case for case-insensitive matching
 * - Removes a small safe set of leading/trailing punctuation commonly introduced by OCR
 */
function courseTimeToMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

export function normalizeCourseName(name: string | null | undefined): string { return domainNormalizeCourseName(name); }

/**
 * Creates a unique compound identity for a section based on:
 * normalized course name + section ID (trimmed).
 *
 * Different courses with the same section ID (e.g. Math Sec 1 vs Physics Sec 1)
 * produce different compound keys and are both preserved.
 */
export function getSectionCompoundKey(courseName: string | null | undefined, sectionId: string | null | undefined): string {
  const normCourse = normalizeCourseName(courseName);
  const cleanId = (sectionId || '').trim().toLowerCase();
  return `${normCourse}:::${cleanId}`;
}

/**
 * Extracts a course code from text (e.g. "BUS 302", "BUS302", "ACT 332", "سلم 101", "CS 101").
 */
export function parseCourseCode(str: string | null | undefined): string | null {
  if (!str) return null;
  const clean = str.trim().replace(/[‐‑‒–—―]/g, '-');
  if (!clean) return null;
  const excludedDept = /^(?:AM|PM|ROOM|RM|BLDG|BUILDING|ID|PHONE|TEL|YEAR|DAY|CAMPUS|INSTRUCTOR|PROF|PROFESSOR)$/i;

  const fullEn = clean.match(/^([A-Za-z]{2,8})\s*[-_]?\s*(\d{1,6}[A-Za-z]?)$/);
  if (fullEn) {
    const dept = fullEn[1].toUpperCase();
    if (excludedDept.test(dept)) return null;
    return `${dept} ${fullEn[2].toUpperCase()}`;
  }

  const fullAr = clean.match(/^([\u0600-\u06FF]{2,8})\s*[-_]?\s*(\d{1,6})$/u);
  if (fullAr) return `${fullAr[1]} ${fullAr[2]}`;

  // Embedded composite code with section/discriminator suffix, e.g. MGT202-New05, BUS202-New05, FIN434-New01
  const embeddedFull = clean.match(/(?:^|[^A-Za-z0-9])([A-Za-z]{2,8})\s*[-_]?\s*(\d{1,6}[A-Za-z]?)(?:[-_](?:[A-Za-z0-9]{1,8}))(?=$|[^A-Za-z0-9])/);
  if (embeddedFull) {
    const dept = embeddedFull[1].toUpperCase();
    if (excludedDept.test(dept)) return null;
    return `${dept} ${embeddedFull[2].toUpperCase()}`;
  }

  const embeddedEn = clean.match(/(?:^|[^A-Za-z0-9])([A-Za-z]{2,8})\s*[-_]?\s*(\d{1,6}[A-Za-z]?)(?=$|[^A-Za-z0-9])/);
  if (embeddedEn) {
    const dept = embeddedEn[1].toUpperCase();
    if (excludedDept.test(dept)) return null;
    return `${dept} ${embeddedEn[2].toUpperCase()}`;
  }
  const embeddedAr = clean.match(/(?:^|[^\u0600-\u06FF0-9])([\u0600-\u06FF]{2,8})\s*[-_]?\s*(\d{1,6})(?=$|[^\u0600-\u06FF0-9])/u);
  if (embeddedAr) return `${embeddedAr[1]} ${embeddedAr[2]}`;
  return null;
}


function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/**
 * Removes embedded course code patterns from course title so user-facing display
 * remains clean and canonical (e.g. "Management Information System (MGT202)" -> "Management Information System").
 */
export function cleanCourseTitle(title: string | null | undefined, courseCode?: string | null): string {
  if (!title) return '';
  let cleaned = title.trim();
  if (courseCode) {
    const codeClean = courseCode.trim().replace(/[\s_-]+/g, '');
    const m = courseCode.match(/^([A-Za-z\u0600-\u06FF]+)[\s_-]*(\d+)/u);
    const patternCode = m ? `${escapeRegExp(m[1])}\\s*${escapeRegExp(m[2])}` : escapeRegExp(codeClean);

    cleaned = cleaned.replace(new RegExp(`\\s*\\([\\s_-]*${patternCode}[\\s_-]*\\)`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`\\s*\\[[\\s_-]*${patternCode}[\\s_-]*\\]`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`^[\\s_-]*${patternCode}[\\s—–:-]+`, 'gi'), '');
    cleaned = cleaned.replace(new RegExp(`[\\s—–:-]+${patternCode}[\\s_-]*$`, 'gi'), '');
  }
  return cleaned.replace(/^[,;:\s—–-]+|[,;:\s—–-]+$/g, '').trim() || title.trim();
}

/**
 * Extracts course code, cleaned course name, and authoritative course identity key from raw inputs.
 * Implements Section 7 Course Identity Rule:
 * Strongest identity: COURSE CODE.
 * Second-level identity: When no course code is available: strong normalized course title.
 */
export function extractCourseIdentityFromRaw(
  rawName: string | null | undefined,
  rawCode?: string | null | undefined
): { courseCode: string | null; cleanCourseName: string; courseIdentityKey: string } {
  let resolvedCode = parseCourseCode(rawCode || '');
  if (!resolvedCode && rawName) {
    resolvedCode = parseCourseCode(rawName);
  }

  const cleanName = cleanCourseTitle(rawName, resolvedCode);

  if (resolvedCode) {
    const key = domainGetCourseIdentityKey(resolvedCode, cleanName);
    return {
      courseCode: resolvedCode,
      cleanCourseName: cleanName || resolvedCode,
      courseIdentityKey: key,
    };
  }

  const key = domainGetCourseIdentityKey(null, cleanName || rawName || '');
  return {
    courseCode: null,
    cleanCourseName: cleanName || rawName || '',
    courseIdentityKey: key,
  };
}

/** Stable course identity: course code is authoritative; title is fallback only when code is absent. */
export function getCourseIdentityKey(courseCode: string | null | undefined, courseName: string | null | undefined): string { return domainGetCourseIdentityKey(courseCode, courseName); }

/**
 * Canonical course key.
 * When course code is present, it MUST NOT append the course name,
 * ensuring OCR title variations (e.g. "Corporate Finance" vs "Corporate Fin.")
 * map to the identical course key (Specification Sections 7, 39).
 */
export function buildCourseKey(courseCode: string | null | undefined, courseName: string | null | undefined): string { return domainBuildCourseKey(courseCode, courseName); }

/** Standard course display format: Course Code - Course Name (Section 2 & 31.32). */
export function formatCourseDisplay(courseCode?: string | null, courseName?: string | null): string {
  const code = (courseCode || '').trim();
  const name = (courseName || '').trim();

  if (code && name) {
    if (name.toUpperCase().startsWith(code.toUpperCase())) {
      const remainder = name.slice(code.length).replace(/^[\s—–:·•-]+/, '').trim();
      if (remainder) {
        return `${code} · ${remainder}`;
      }
      return code;
    }
    return `${code} · ${name}`;
  }

  return code || name || 'Untitled Course';
}

/**
 * Returns true only for an internal OCR identifier created by this application.
 * Real visible section identifiers such as SEC-01, A01, New01, 001 and L01
 * are NEVER treated as placeholders.
 */
export function isPlaceholderSectionId(id: string | null | undefined): boolean {
  if (!id) return true;
  const clean = String(id).trim().toUpperCase();
  return clean.startsWith('OCR:') || clean.startsWith('CHUNK:') || clean.startsWith('TEMP:');
}

/**
 * Course-name cleanup is intentionally conservative.
 * It may remove obvious transport noise at the edges, but it MUST NOT invent a
 * human-readable title from a course code and MUST NOT use a section code to
 * manufacture a title.
 */
export function sanitizeCourseNameOnly(rawName: string, _sectionId?: string): string {
  if (!rawName) return '';
  // Only transport-safe normalization is allowed here. The visible course title
  // is source data and must not be semantically shortened or rewritten.
  return String(rawName)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;:]+|[,;:]+$/g, '')
    .trim();
}

/**
 * No longer performs speculative course/section reconstruction.
 * The model/schema parser is the source of truth for identity. This helper only
 * separates an explicitly embedded, labelled section suffix when that suffix is
 * already part of the supplied identifier. It NEVER fabricates a title or ID.
 */
export function disentangleCourseAndSection(
  rawName: string,
  rawId: string,
  _knownCourseTitles?: Map<string, string>
): { name: string; id: string; credits: number | null } {
  // This compatibility helper is intentionally semantic-free. OCR identity is
  // established from explicit course_code/section_code fields, not guessed from an
  // application ID. Keeping the supplied values prevents hidden title/section
  // synthesis in callers that still import this legacy function.
  return {
    name: sanitizeCourseNameOnly(rawName),
    id: String(rawId || '').trim(),
    credits: null,
  };
}


function sessionIdentity(session: Section['sessions'][number]): string {
  const type = String(session.type || 'Other').trim().toLowerCase();
  const custom = type === 'custom' ? String(session.customType || '').trim().toLowerCase().replace(/\s+/g, ' ') : '';
  // Ambiguity is metadata, not identity. A later OCR/user pass resolving an
  // ambiguous time must reconcile with the same meeting rather than create a duplicate.
  return `${String(session.day || '').trim().toUpperCase()}|${String(session.start || '').trim()}|${String(session.end || '').trim()}|${type}|${custom}`;
}

function sessionRawIdentity(value: unknown): string {
  if (value && typeof value === 'object') { const fp = canonicalRawMeetingFingerprint(value); if (fp) return fp; }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const type = String(record.type ?? record.meeting_type ?? 'Other').trim().toLowerCase();
  const custom = type === 'custom' ? String(record.customType ?? record.custom_type ?? '').trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return `${String(record.day ?? '').trim().toUpperCase()}|${String(record.start_time ?? record.start ?? '').trim()}|${String(record.end_time ?? record.end ?? '').trim()}|${type}|${custom}`;
}

function mergeSectionLosslessly(target: Section, incoming: Section): void {
  if (!target.name && incoming.name) target.name = incoming.name;
  if (!target.courseCode && incoming.courseCode) target.courseCode = incoming.courseCode;
  if (!target.instructor && incoming.instructor) target.instructor = incoming.instructor;
  if (!target.tutorialCode && incoming.tutorialCode) target.tutorialCode = incoming.tutorialCode;
  if (target.partTime == null && incoming.partTime != null) target.partTime = incoming.partTime;

  if ((!target.sectionCode || target.sectionCodeMissing) && incoming.sectionCode && !incoming.sectionCodeMissing) {
    target.sectionCode = incoming.sectionCode;
    target.sectionCodeMissing = false;
  }
  if (!target.rawSectionCode && incoming.rawSectionCode) target.rawSectionCode = incoming.rawSectionCode;
  if (!target.sectionCodeRaw && incoming.sectionCodeRaw) target.sectionCodeRaw = incoming.sectionCodeRaw;
  if (!target.canonicalSectionKey && incoming.canonicalSectionKey) target.canonicalSectionKey = incoming.canonicalSectionKey;

  const variants = new Set<string>([
    ...(target.rawSectionCodeVariants || []),
    ...(incoming.rawSectionCodeVariants || []),
  ]);
  if (target.rawSectionCode) variants.add(target.rawSectionCode);
  if (target.sectionCodeRaw) variants.add(target.sectionCodeRaw);
  if (incoming.rawSectionCode) variants.add(incoming.rawSectionCode);
  if (incoming.sectionCodeRaw) variants.add(incoming.sectionCodeRaw);
  target.rawSectionCodeVariants = Array.from(variants);

  if (target.sectionCode) {
    const cleanDisplay = canonicalizeDisplaySectionCode(target.sectionCode);
    if (cleanDisplay) target.sectionCode = cleanDisplay;
  }

  if (!target.normalizedSectionIdentity && incoming.normalizedSectionIdentity) target.normalizedSectionIdentity = incoming.normalizedSectionIdentity;
  if (!target.sectionKey && incoming.sectionKey) target.sectionKey = incoming.sectionKey;
  if (!target.sectionRelationship && incoming.sectionRelationship) target.sectionRelationship = incoming.sectionRelationship;

  // Preserve meeting metadata when two representations reconcile to the same meeting.
  target.sessions = (target.sessions || []).map((existing) => {
    const match = (incoming.sessions || []).find((candidate) => sessionIdentity(candidate) === sessionIdentity(existing));
    if (!match) return existing;
    return {
      ...existing,
      customType: existing.customType || match.customType,
      ambiguousTime: existing.ambiguousTime && !match.resolvedFromAmbiguousTime ? true : Boolean(match.ambiguousTime),
      resolvedFromAmbiguousTime: Boolean(existing.resolvedFromAmbiguousTime || match.resolvedFromAmbiguousTime),
      id: existing.id || match.id,
    };
  });

  const creditValues = new Set<number>([
    ...(target.creditHoursConflict || []),
    ...(incoming.creditHoursConflict || []),
    ...(target.credits == null ? [] : [Number(target.credits)]),
    ...(incoming.credits == null ? [] : [Number(incoming.credits)]),
  ].filter((v) => Number.isFinite(v)));
  if (creditValues.size > 1) {
    target.credits = null;
    target.creditHoursConflict = Array.from(creditValues).sort((a, b) => a - b);
    target.needsReview = true;
    target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), 'credit_conflict']));
  } else if (target.credits == null && incoming.credits != null && !target.creditHoursConflict?.length) {
    target.credits = incoming.credits;
  }

  target.conflictingMeetings = [...(target.conflictingMeetings || [])];
  for (const incomingSession of incoming.sessions || []) {
    if (target.sessions.some((existing) => sessionIdentity(existing) === sessionIdentity(incomingSession))) continue;
    const conflictIndex = target.sessions.findIndex((existing) => existing.day === incomingSession.day && (existing.type || 'Other') === (incomingSession.type || 'Other'));
    if (conflictIndex >= 0) {
      const existingSession = target.sessions[conflictIndex];
      const existingStart = courseTimeToMinutes(existingSession.start);
      const existingEnd = courseTimeToMinutes(existingSession.end);
      const incomingStart = courseTimeToMinutes(incomingSession.start);
      const incomingEnd = courseTimeToMinutes(incomingSession.end);
      const overlaps = existingStart < incomingEnd && incomingStart < existingEnd;
      target.sessions.push(incomingSession);
      const conflictKeys = new Set((target.conflictingMeetings || []).map(sessionRawIdentity));
      for (const candidate of [
        { day: existingSession.day, start_time: existingSession.start, end_time: existingSession.end, type: existingSession.type, customType: existingSession.customType, reason: overlaps ? 'overlapping_same_day_and_type' : 'multiple_same_day_and_type' },
        { day: incomingSession.day, start_time: incomingSession.start, end_time: incomingSession.end, type: incomingSession.type, customType: incomingSession.customType, reason: overlaps ? 'overlapping_same_day_and_type' : 'multiple_same_day_and_type' },
      ]) {
        const key = sessionRawIdentity(candidate);
        if (!conflictKeys.has(key)) {
          target.conflictingMeetings.push(candidate);
          conflictKeys.add(key);
        }
      }
      target.needsReview = true;
      target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), overlaps ? 'conflicting_meeting' : 'multiple_same_day_and_type']));
    } else {
      target.sessions.push(incomingSession);
    }
  }
  for (const conflict of incoming.conflictingMeetings || []) {
    const key = sessionRawIdentity(conflict);
    if (!key || !(target.conflictingMeetings || []).some((existing) => sessionRawIdentity(existing) === key)) {
      target.conflictingMeetings.push(conflict);
    }
  }
  target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), ...(incoming.reviewReasons || [])]));
  target.sourceImageIndexes = Array.from(new Set([...(target.sourceImageIndexes || []), ...(incoming.sourceImageIndexes || [])])).sort((a, b) => a - b);
  if (!target.ocrRunId && incoming.ocrRunId) target.ocrRunId = incoming.ocrRunId;
  if (!target.courseCodeInferenceSource && incoming.courseCodeInferenceSource) target.courseCodeInferenceSource = incoming.courseCodeInferenceSource;
  target.rawOcrEvidence = [...(target.rawOcrEvidence || []), ...(incoming.rawOcrEvidence || [])];
  target.needsReview = Boolean(target.needsReview || incoming.needsReview || target.conflictingMeetings.length);
}

function reconcileCreditConflictsAcrossCourse(sections: Section[]): void {
  const values = new Set<number>();
  for (const section of sections) {
    for (const value of section.creditHoursConflict || []) if (Number.isFinite(Number(value))) values.add(Number(value));
    if (section.credits != null && Number.isFinite(Number(section.credits))) values.add(Number(section.credits));
  }
  if (values.size <= 1) return;
  const normalized = Array.from(values).sort((a, b) => a - b);
  for (const section of sections) {
    section.credits = null;
    section.creditHoursConflict = normalized;
    section.needsReview = true;
    section.reviewReasons = Array.from(new Set([...(section.reviewReasons || []), 'credit_conflict']));
  }
}

/**
 * Lossless batch reconciliation for already-normalized OCR sections.
 * Identity is course-code-first. Missing visible section codes are NOT merged
 * automatically because two different sections can legitimately share the same
 * schedule. Exact duplicates with the same explicit section code are merged.
 */
export function deduplicateParsedBatch(sections: Section[]): Section[] {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const out: Section[] = [];
  const byCourseAndSection = new Map<string, Section>();

  const copy = (sec: Section): Section => ({
    ...sec,
    name: sanitizeCourseNameOnly(sec.name || ''),
    courseCode: sec.courseCode ?? null,
    sectionCode: sec.sectionCode ?? null,
    rawSectionCode: sec.rawSectionCode ?? sec.sectionCode ?? null,
    sectionCodeRaw: sec.sectionCodeRaw ?? sec.rawSectionCode ?? sec.sectionCode ?? null,
    normalizedSectionIdentity: sec.normalizedSectionIdentity ?? null,
    sectionKey: sec.sectionKey ?? null,
    sectionRelationship: sec.sectionRelationship,
    sectionCodeMissing: Boolean(sec.sectionCodeMissing || !sec.sectionCode),
    sessions: [...(sec.sessions || [])],
    reviewReasons: [...(sec.reviewReasons || [])],
    conflictingMeetings: [...(sec.conflictingMeetings || [])],
    creditHoursConflict: sec.creditHoursConflict ? [...sec.creditHoursConflict] : null,
    rawOcrEvidence: [...(sec.rawOcrEvidence || [])],
    sourceImageIndexes: [...(sec.sourceImageIndexes || [])],
    ocrRunId: sec.ocrRunId,
    courseCodeInferenceSource: sec.courseCodeInferenceSource,
    reviewAcknowledged: Boolean(sec.reviewAcknowledged),
    incompleteMeetings: [...(sec.incompleteMeetings || [])],
    needsReview: Boolean(sec.needsReview),
  });

  const identity = (sec: Section) => getCourseIdentityKey(sec.courseCode, sec.name);
  const merge = (target: Section, incoming: Section) => mergeSectionLosslessly(target, incoming);

  // Group sections by course first to consolidate composite/derived codes per course
  const courseMap = new Map<string, Section[]>();
  for (const original of sections) {
    const sec = copy(original);
    const courseKey = identity(sec);
    sec.courseKey = courseKey;
    const list = courseMap.get(courseKey) || [];
    list.push(sec);
    courseMap.set(courseKey, list);
  }

  for (const [courseKey, courseSections] of courseMap) {
    const formattedGroup = mergeDuplicateCanonicalSections(courseSections, mergeSectionLosslessly);
    const consolidated = consolidateDerivedCompositeSections(formattedGroup, mergeSectionLosslessly);
    for (const sec of consolidated) {
      sec.courseKey = courseKey;
      const resolvedSec = getResolvedSectionIdentity(sec);

      // Missing section identity cannot be inferred. Preserve distinct candidates,
      // but collapse a byte-for-byte-equivalent normalized duplicate from repeated
      // screenshots so duplicate evidence does not become duplicate catalog rows.
      if (sec.sectionCodeMissing || !resolvedSec) {
        sec.sectionCodeMissing = true;
        sec.needsReview = true;
        sec.reviewReasons = Array.from(new Set([...(sec.reviewReasons || []), 'section_code_missing']));
        const fingerprint = JSON.stringify({
          course: courseKey,
          name: sanitizeCourseNameOnly(sec.name),
          credits: sec.credits ?? null,
          instructor: sec.instructor ?? null,
          sessions: (sec.sessions || []).map(sessionIdentity).sort(),
          conflicts: (sec.conflictingMeetings || []).map(sessionRawIdentity).sort(),
          incompleteMeetings: (sec.incompleteMeetings || []).map((m) => JSON.stringify(m)).sort(),
        });
        const duplicate = out.find((candidate) => (candidate.sectionCodeMissing || !getResolvedSectionIdentity(candidate)) && JSON.stringify({
          course: candidate.courseKey || identity(candidate),
          name: sanitizeCourseNameOnly(candidate.name),
          credits: candidate.credits ?? null,
          instructor: candidate.instructor ?? null,
          sessions: (candidate.sessions || []).map(sessionIdentity).sort(),
          conflicts: (candidate.conflictingMeetings || []).map(sessionRawIdentity).sort(),
          incompleteMeetings: (candidate.incompleteMeetings || []).map((m) => JSON.stringify(m)).sort(),
        }) === fingerprint);
        if (duplicate) mergeSectionLosslessly(duplicate, sec);
        else out.push(sec);
        continue;
      }

      const key = `${courseKey}:::${resolvedSec.trim().toLowerCase()}`;
      const existing = byCourseAndSection.get(key);
      if (!existing) {
        byCourseAndSection.set(key, sec);
        out.push(sec);
      } else {
        merge(existing, sec);
      }
    }
  }

  // Attach split-image meeting evidence to an explicit section only when the
  // course identity matches and the association is supported by exact meeting
  // evidence (or there is exactly one explicit section with no meetings yet).
  const courseBuckets = new Map<string, Section[]>();
  for (const section of out) {
    const key = section.courseKey || identity(section);
    const list = courseBuckets.get(key) || [];
    list.push(section);
    courseBuckets.set(key, list);
  }
  const attachedMissing = new Set<Section>();
  for (const group of courseBuckets.values()) {
    const explicit = group.filter((section) => Boolean(getResolvedSectionIdentity(section)) && !section.sectionCodeMissing);
    const missing = group.filter((section) => !getResolvedSectionIdentity(section) || section.sectionCodeMissing);
    if (!explicit.length) continue;
    for (const missingSection of missing) {
      const matches = explicit.filter((candidate) =>
        (missingSection.sessions || []).length > 0 &&
        (missingSection.sessions || []).some((incoming) =>
          (candidate.sessions || []).some((existing) => sessionIdentity(existing) === sessionIdentity(incoming))
        )
      );
      const fallback = matches.length === 0 && explicit.length === 1 && explicit[0].sessions.length === 0 && missingSection.sessions.length > 0
        ? [explicit[0]]
        : matches;
      if (fallback.length === 1) {
        const target = fallback[0];
        if (!target.sessions.length && missingSection.sessions.length > 0 && matches.length === 0) {
          target.needsReview = true;
          target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), 'section_association_inferred']));
        }
        mergeSectionLosslessly(target, missingSection);
        target.sectionCodeMissing = false;
        attachedMissing.add(missingSection);
      }
    }
  }

  // An attached missing-code record has been consumed as evidence for the explicit
  // section; leaving it in the result would duplicate the same section.
  if (attachedMissing.size) {
    for (let index = out.length - 1; index >= 0; index--) {
      if (attachedMissing.has(out[index])) out.splice(index, 1);
    }
  }

  const courseGroups = new Map<string, Section[]>();
  for (const section of out) {
    const key = section.courseKey || getCourseIdentityKey(section.courseCode, section.name);
    const list = courseGroups.get(key) || [];
    list.push(section);
    courseGroups.set(key, list);
  }
  for (const group of courseGroups.values()) reconcileCreditConflictsAcrossCourse(group);
  return out;
}

/**
 * Deduplicates incoming sections against catalog content without inventing an
 * extracted section code. A missing section remains missing and is therefore
 * inserted as a reviewable record rather than being renamed to a believable ID.
 */
function exactMissingSectionSignature(section: Section): string {
  return JSON.stringify({
    course: getCourseIdentityKey(section.courseCode, section.name),
    name: sanitizeCourseNameOnly(section.name),
    credits: section.credits ?? null,
    creditHoursConflict: section.creditHoursConflict || null,
    instructor: section.instructor ?? null,
    tutorialCode: section.tutorialCode ?? null,
    sessions: (section.sessions || []).map(sessionIdentity).sort(),
    incompleteMeetings: (section.incompleteMeetings || []).map((meeting) => JSON.stringify(meeting)).sort(),
    conflicts: (section.conflictingMeetings || []).map(sessionRawIdentity).sort(),
  });
}

export function deduplicateSections(
  existingSections: Section[],
  incomingSections: Section[]
): {
  insertedSections: Section[];
  updatedSections: Section[];
  updatedAllSections: Section[];
  skippedCount: number;
  updatedCount: number;
} {
  const cloneSection = (section: Section): Section => ({
    ...section,
    sessions: [...(section.sessions || [])],
    reviewReasons: [...(section.reviewReasons || [])],
    conflictingMeetings: [...(section.conflictingMeetings || [])],
    creditHoursConflict: section.creditHoursConflict ? [...section.creditHoursConflict] : null,
    rawOcrEvidence: [...(section.rawOcrEvidence || [])],
    incompleteMeetings: [...(section.incompleteMeetings || [])],
  });
  const workingSections = existingSections.map(cloneSection);
  const insertedSections: Section[] = [];
  const updatedSections: Section[] = [];
  let skippedCount = 0;
  let updatedCount = 0;

  const visibleSectionCode = (s: Section): string | null => {
    const code = s.sectionCode?.trim();
    return code || null;
  };
  const courseIdentity = (s: Section): string => {
    if (s.courseKey?.startsWith('code:') || s.courseKey?.startsWith('name:')) return s.courseKey;
    return getCourseIdentityKey(s.courseCode, s.name);
  };
  const signature = (s: Section): string => JSON.stringify({
    courseIdentity: courseIdentity(s),
    sectionCode: visibleSectionCode(s),
    sectionCodeMissing: Boolean(s.sectionCodeMissing),
    name: sanitizeCourseNameOnly(s.name),
    credits: s.credits ?? null,
    instructor: s.instructor ?? null,
    conflicts: (s.conflictingMeetings || []).map(sessionRawIdentity).sort(),
    needsReview: Boolean(s.needsReview),
    reviewReasons: [...(s.reviewReasons || [])].sort(),
    creditHoursConflict: s.creditHoursConflict || null,
    sourceImageIndexes: s.sourceImageIndexes || [],
    ocrRunId: s.ocrRunId || null,
    reviewAcknowledged: Boolean(s.reviewAcknowledged),
    courseCodeInferenceSource: s.courseCodeInferenceSource || null,
    rawOcrEvidence: (s.rawOcrEvidence || []).map((value) => JSON.stringify(value)).sort(),
    incompleteMeetings: (s.incompleteMeetings || []).map((value) => JSON.stringify(value)).sort(),
    sessions: (s.sessions || []).map((x) => ({ day: x.day, start: x.start, end: x.end, type: x.type, ambiguousTime: Boolean(x.ambiguousTime), resolvedFromAmbiguousTime: Boolean(x.resolvedFromAmbiguousTime) })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });

  for (const incoming of incomingSections || []) {
    const sec: Section = {
      ...incoming,
      name: sanitizeCourseNameOnly(incoming.name),
      sectionCode: visibleSectionCode(incoming),
      sectionCodeMissing: Boolean(incoming.sectionCodeMissing || !visibleSectionCode(incoming)),
      courseKey: courseIdentity(incoming),
      // Keep the incoming ID as an internal/application identity. For OCR it is
      // never presented to the user as though it were an extracted section code.
      id: incoming.id?.trim() || `internal:${courseIdentity(incoming)}:${incoming.sectionCode || 'missing'}:${insertedSections.length}`,
    };

    const incomingCode = visibleSectionCode(sec);

    // A retry or a separate OCR request may contain only the meeting evidence for
    // a section whose visible code was captured previously. Attach such evidence
    // only when course identity matches and a normalized meeting matches exactly.
    // This is identity-safe and never fabricates a visible section code.
    if (!incomingCode) {
      const meetingMatches = workingSections.filter((existing) =>
        courseIdentity(existing) === courseIdentity(sec) &&
        Boolean(existing.sectionCode?.trim()) &&
        !existing.sectionCodeMissing &&
        (sec.sessions || []).some((incomingSession) =>
          (existing.sessions || []).some((existingSession) => sessionIdentity(existingSession) === sessionIdentity(incomingSession))
        )
      );
      if (meetingMatches.length === 1) {
        const target = meetingMatches[0];
        const before = signature(target);
        mergeSectionLosslessly(target, sec);
        const after = signature(target);
        if (before !== after) {
          updatedSections.push(target);
          updatedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }
    }

    const incomingCanonical = incomingCode ? canonicalizeSectionIdentity(incomingCode) : null;
    const existingIndex = incomingCanonical
      ? workingSections.findIndex((existing) => {
          if (courseIdentity(existing) !== courseIdentity(sec)) return false;
          const exCode = visibleSectionCode(existing);
          if (!exCode) return false;
          return canonicalizeSectionIdentity(exCode) === incomingCanonical;
        })
      : workingSections.findIndex((existing) => !visibleSectionCode(existing) && courseIdentity(existing) === courseIdentity(sec) && exactMissingSectionSignature(existing) === exactMissingSectionSignature(sec));

    if (existingIndex >= 0) {
      const existing = workingSections[existingIndex];
      const before = signature(existing);
      const updated: Section = {
        ...existing,
        sessions: [...(existing.sessions || [])],
        reviewReasons: [...(existing.reviewReasons || [])],
        conflictingMeetings: [...(existing.conflictingMeetings || [])],
        rawOcrEvidence: [...(existing.rawOcrEvidence || [])],
        incompleteMeetings: [...(existing.incompleteMeetings || [])],
        sourceImageIndexes: [...(existing.sourceImageIndexes || [])],
        ocrRunId: existing.ocrRunId,
        courseCodeInferenceSource: existing.courseCodeInferenceSource,
        reviewAcknowledged: Boolean(existing.reviewAcknowledged),
        creditHoursConflict: existing.creditHoursConflict ? [...existing.creditHoursConflict] : null,
        id: existing.id,
        courseKey: courseIdentity(existing),
        sectionCode: canonicalizeDisplaySectionCode(existing.sectionCode || incomingCode) || existing.sectionCode || incomingCode,
        sectionCodeMissing: !incomingCode,
      };
      mergeSectionLosslessly(updated, sec);
      const after = signature(updated);
      if (before === after) {
        skippedCount++;
      } else {
        workingSections[existingIndex] = updated;
        updatedSections.push(updated);
        updatedCount++;
      }
      continue;
    }

    workingSections.push(sec);
    insertedSections.push(sec);
  }

  const grouped = new Map<string, Section[]>();
  for (const section of workingSections) {
    const key = courseIdentity(section);
    const list = grouped.get(key) || [];
    list.push(section);
    grouped.set(key, list);
  }
  for (const group of grouped.values()) reconcileCreditConflictsAcrossCourse(group);

  return {
    insertedSections,
    updatedSections,
    updatedAllSections: workingSections,
    skippedCount,
    updatedCount,
  };
}

export interface GroupedCourse {
  courseName: string;
  sections: Section[];
  credits: number | null;
  courseKey?: string;
  courseCode?: string | null;
}

/**
 * Groups using course-code-first identity. Course titles are display data and
 * cannot override a differing course code.
 */
export function groupSectionsByCourse(sections: Section[]): GroupedCourse[] {
  // Catalog sections are normalized at ingestion boundaries. Keep this render-time
  // operation intentionally lightweight: grouping must not rerun OCR reconciliation.
  const groups = new Map<string, GroupedCourse>();
  for (const original of Array.isArray(sections) ? sections : []) {
    const sec = { ...original, name: sanitizeCourseNameOnly(original.name || '') };
    const key = sec.courseKey || getCourseIdentityKey(sec.courseCode, sec.name);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        courseName: sec.name || 'Course title missing',
        courseCode: sec.courseCode ?? null,
        courseKey: key,
        sections: [sec],
        credits: sec.credits ?? null,
      });
    } else {
      group.sections.push(sec);
      if (group.credits != null && sec.credits != null && group.credits !== sec.credits) group.credits = null;
      else if (group.credits == null && sec.credits != null) {
        const allValues = group.sections.map((candidate) => candidate.credits).filter((value): value is number => value != null);
        if (new Set(allValues).size === 1) group.credits = sec.credits;
      }
      if (group.courseName.length < sec.name.length && sec.name) group.courseName = sec.name;
      if (!group.courseCode && sec.courseCode) group.courseCode = sec.courseCode;
    }
  }
  return Array.from(groups.values());
}

/**
 * Builds optimizer input using stable course identity. Same-name/different-code
 * courses stay separate; same-code/different-title records share one course.
 */
export function buildOptimizerCourseMap(
  sections: Section[]
): {
  courseMap: Record<string, Section[]>;
  fixedCourses: Section[];
} {
  const grouped = groupSectionsByCourse(sections);
  const courseMap: Record<string, Section[]> = {};
  for (const group of grouped) {
    const key = group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName);
    courseMap[key] = group.sections.map((sec) => ({
      ...sec,
      courseKey: key,
      name: group.courseName,
      courseCode: group.courseCode ?? sec.courseCode ?? null,
    }));
  }
  return { courseMap, fixedCourses: [] };
}

/**
 * Generates a stable content signature for a generated schedule.
 * Sorted by normalized course name and section ID so it is invariant to array order.
 * Survives recalculations and is suitable for saving persistent favorites.
 */
export function getScheduleSignature(schedule: OptimizationResult): string {
  if (!schedule || !Array.isArray(schedule.sections)) return '';
  return schedule.sections
    .map((s) => {
      const sessions = (s.sessions || [])
        .map((sess) => `${sess.day}:${sess.start}-${sess.end}:${sess.type || ''}:${sess.type === 'Custom' ? (sess.customType || '') : ''}`)
        .sort()
        .join(',');
      const course = canonicalCourseKey(s);
      const sectionCode = (s.sectionCode || '').trim().toUpperCase();
      const semanticSection = sectionCode || sessions;
      return `${course}:::${semanticSection}:::${s.credits ?? null}:::${sessions}`;
    })
    .sort()
    .join('|||');
}

/**
 * Computes a deterministic content signature of the current courses and preferences.
 * Any change to course list, section times/IDs, locked status, or preferences
 * will produce a different signature, enabling accurate stale-result detection.
 */
export function computeInputsSignature(
  sections: Section[],
  preferences: SchedulePreferences
): string {
  const sectionSignatures = (sections || [])
    .map((s) => {
      const credits = s.credits ?? null;
      const sortedSessions = (s.sessions || [])
        .map((sess) => `${sess.day}:${sess.start}-${sess.end}:${sess.type || ''}:${sess.type === 'Custom' ? (sess.customType || '') : ''}`)
        .sort()
        .join(',');
      const course = canonicalCourseKey(s);
      const sectionCode = (s.sectionCode || '').trim().toUpperCase();
      const semanticSection = sectionCode || sortedSessions;
      return `${course}|${semanticSection}|${credits}|${sortedSessions}`;
    })
    .sort()
    .join('||');

  const normalizedMandatoryKeys = Array.from(new Set((preferences.mandatoryCourseKeys || [])
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().toLowerCase()))).sort().join(',');
  const normalizedLegacyLabels = Array.from(new Set((preferences.mandatoryCourses || [])
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => normalizeCourseName(v)))).sort().join(',');
  const requestedDayBuckets = Array.from(new Set<number>((preferences.dayBuckets || [1,2,3,4,5,6,7])
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)))
    .sort((a, b) => a - b).join(',');
  const freeDays = Array.from(new Set(preferences.freeDays || [])).sort().join(',');

  const prefsSignature = [
    `cr:${preferences.targetCredits ?? 'any'}`,
    `count:${preferences.targetCourseCount ?? 'any'}`,
    `mandkeys:${normalizedMandatoryKeys}`,
    `mandlabels:${normalizedLegacyLabels}`,
    `buckets:${requestedDayBuckets}`,
    `range:${preferences.useCreditRange === true ? 'on' : 'off'}:${preferences.minCredits ?? 'any'}:${preferences.maxCredits ?? 'any'}`,
    `start:${preferences.earliestStartTime || 'ANY'}`,
    `end:${preferences.latestEndTime || 'ANY'}`,
    `free:${freeDays}`,
    `maxdays:${preferences.maxDays ?? 'any'}`,
    `compact:${preferences.preferCompactDays === true ? 'on' : 'off'}`,
  ].join(';');

  return `SECTIONS[${sectionSignatures}]::PREFS[${prefsSignature}]`;
}

export function computeSectionsSignature(sections: Section[]): string {
  return (sections || []).map((s) => {
    const sessions = (s.sessions || []).map((sess) => `${sess.day}:${sess.start}-${sess.end}:${sess.type || ''}:${sess.type === 'Custom' ? (sess.customType || '') : ''}`).sort().join(',');
    const course = canonicalCourseKey(s);
    const sectionCode = (s.sectionCode || '').trim().toUpperCase();
    return `${course}|${sectionCode || sessions}|${s.credits ?? null}|${sessions}`;
  }).sort().join('||');
}

export function areSchedulePreferencesEqual(a: SchedulePreferences, b: SchedulePreferences): boolean {
  const norm = (p: SchedulePreferences) => ({
    targetCredits: p.targetCredits ?? null,
    targetCourseCount: p.targetCourseCount ?? null,
    mandatoryCourseKeys: Array.from(new Set((p.mandatoryCourseKeys || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean))).sort(),
    mandatoryCourses: Array.from(new Set((p.mandatoryCourses || []).map(normalizeCourseName).filter(Boolean))).sort(),
    dayBuckets: Array.from(new Set(p.dayBuckets || [1,2,3,4,5,6,7])).sort((x,y)=>x-y),
    useCreditRange: p.useCreditRange === true, minCredits: p.minCredits ?? null, maxCredits: p.maxCredits ?? null,
    earliestStartTime: p.earliestStartTime || 'ANY', latestEndTime: p.latestEndTime || 'ANY',
    freeDays: Array.from(new Set(p.freeDays || [])).sort(), maxDays: p.maxDays ?? null, preferCompactDays: p.preferCompactDays === true,
  });
  const x = norm(a), y = norm(b);
  if (x.targetCredits !== y.targetCredits || x.targetCourseCount !== y.targetCourseCount || x.useCreditRange !== y.useCreditRange || x.minCredits !== y.minCredits || x.maxCredits !== y.maxCredits || x.earliestStartTime !== y.earliestStartTime || x.latestEndTime !== y.latestEndTime || x.maxDays !== y.maxDays || x.preferCompactDays !== y.preferCompactDays) return false;
  return x.mandatoryCourseKeys.join('|') === y.mandatoryCourseKeys.join('|') && x.mandatoryCourses.join('|') === y.mandatoryCourses.join('|') && x.dayBuckets.join('|') === y.dayBuckets.join('|') && x.freeDays.join('|') === y.freeDays.join('|');
}

export interface InputsChangeSummary {
  isStale: boolean;
  reasons: string[];
  deletedCourseNames: string[]; // Human-readable course labels removed from the catalog
  addedCourseNames: string[]; // Human-readable course labels newly added to the catalog
  modifiedCourseNames: string[]; // Human-readable course labels whose sections changed
  hasStructuralCourseChange: boolean;
  hasPreferenceChange: boolean;
}

/**
 * Compares generated schedules against current courses and preferences.
 * Identifies if results are stale and lists specific human-readable reasons
 * (e.g. course removed, sections edited, preferences changed).
 */
export function getInputsChangeSummary(
  output: OptimizerOutput | null,
  currentSections: Section[],
  currentPreferences: SchedulePreferences
): InputsChangeSummary {
  if (!output) {
    return {
      isStale: false,
      reasons: [],
      deletedCourseNames: [],
      addedCourseNames: [],
      modifiedCourseNames: [],
      hasStructuralCourseChange: false,
      hasPreferenceChange: false,
    };
  }

  if (!output.generatedInputsSignature) {
    return {
      isStale: true,
      reasons: ['Saved results have no input signature and must be recalculated to verify they match the current courses and preferences.'],
      deletedCourseNames: [],
      addedCourseNames: [],
      modifiedCourseNames: [],
      hasStructuralCourseChange: true,
      hasPreferenceChange: true,
    };
  }

  const currentSig = computeInputsSignature(currentSections, currentPreferences);
  if (currentSig === output.generatedInputsSignature) {
    return {
      isStale: false,
      reasons: [],
      deletedCourseNames: [],
      addedCourseNames: [],
      modifiedCourseNames: [],
      hasStructuralCourseChange: false,
      hasPreferenceChange: false,
    };
  }

  const reasons: string[] = [];
  const prevSections = output.sectionsSnapshot || output.allSectionsConsidered || [];
  const prevPrefs = output.preferencesUsed || ({} as SchedulePreferences);

  // Group by authoritative course identity. Legacy records without a courseKey/code
  // fall back to normalized course name so old saved results remain comparable.
  const courseComparisonKey = (s: Section): string => s.courseKey || getCourseIdentityKey(s.courseCode, s.name);
  const prevCourseMap = new Map<string, Section[]>();
  for (const s of prevSections) {
    if (!s || typeof s !== 'object') continue;
    const key = courseComparisonKey(s);
    if (!prevCourseMap.has(key)) prevCourseMap.set(key, []);
    prevCourseMap.get(key)!.push(s);
  }

  const currCourseMap = new Map<string, Section[]>();
  for (const s of currentSections) {
    const key = courseComparisonKey(s);
    if (!currCourseMap.has(key)) currCourseMap.set(key, []);
    currCourseMap.get(key)!.push(s);
  }

  const deletedCourseNames: string[] = [];
  const addedCourseNames: string[] = [];
  const modifiedCourseNames: string[] = [];

  for (const [norm, pSecs] of prevCourseMap.entries()) {
    if (!currCourseMap.has(norm)) {
      const displayName = pSecs[0]?.name || norm;
      deletedCourseNames.push(displayName);
      reasons.push(`Course "${displayName}" was removed from your catalog`);
    } else {
      const cSecs = currCourseMap.get(norm)!;
      // Check if sections or sessions were modified
      const pSig = pSecs
        .map((s) => `${s.id}|${s.credits ?? null}|${(s.sessions || []).map((ss) => `${ss.day}${ss.start}${ss.end}`).sort().join(',')}`)
        .sort()
        .join(';');
      const cSig = cSecs
        .map((s) => `${s.id}|${s.credits ?? null}|${(s.sessions || []).map((ss) => `${ss.day}${ss.start}${ss.end}`).sort().join(',')}`)
        .sort()
        .join(';');
      if (pSig !== cSig) {
        const displayName = cSecs[0]?.name || norm;
        modifiedCourseNames.push(displayName);
        reasons.push(`Sections or timings for "${displayName}" were modified`);
      }
    }
  }

  for (const [norm, cSecs] of currCourseMap.entries()) {
    if (!prevCourseMap.has(norm)) {
      const displayName = cSecs[0]?.name || norm;
      addedCourseNames.push(displayName);
      reasons.push(`New course "${displayName}" was added to your catalog`);
    }
  }

  let hasPreferenceChange = false;
  const prefValue = (p: SchedulePreferences | undefined) => ({
    targetCredits: p?.targetCredits ?? null,
    targetCourseCount: p?.targetCourseCount ?? null,
    mandatoryCourseKeys: Array.from(new Set((p?.mandatoryCourseKeys || []).map(String).map((v) => v.trim().toLowerCase()).filter(Boolean))).sort(),
    mandatoryCourses: Array.from(new Set((p?.mandatoryCourses || []).map(normalizeCourseName).filter(Boolean))).sort(),
    dayBuckets: Array.from(new Set(p?.dayBuckets || [1,2,3,4,5,6,7])).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a,b) => a-b),
    useCreditRange: p?.useCreditRange === true,
    minCredits: p?.minCredits ?? null,
    maxCredits: p?.maxCredits ?? null,
    earliestStartTime: p?.earliestStartTime || 'ANY',
    latestEndTime: p?.latestEndTime || 'ANY',
    freeDays: Array.from(new Set(p?.freeDays || [])).sort(),
    maxDays: p?.maxDays ?? null,
    preferCompactDays: p?.preferCompactDays === true,
  });
  const prevPrefValue = prefValue(prevPrefs);
  const currPrefValue = prefValue(currentPreferences);
  if (JSON.stringify(prevPrefValue) !== JSON.stringify(currPrefValue)) {
    hasPreferenceChange = true;
    const labels = [
      ['targetCredits', 'Target credits changed'],
      ['targetCourseCount', 'Target course count changed'],
      ['mandatoryCourseKeys', 'Mandatory courses selection was updated'],
      ['mandatoryCourses', 'Mandatory course labels changed'],
      ['dayBuckets', 'Campus day result groups were updated'],
      ['useCreditRange', 'Credit range preference changed'],
      ['minCredits', 'Minimum credit preference changed'],
      ['maxCredits', 'Maximum credit preference changed'],
      ['earliestStartTime', 'Earliest start-time preference changed'],
      ['latestEndTime', 'Latest end-time preference changed'],
      ['freeDays', 'Free-day preference changed'],
      ['maxDays', 'Maximum campus days changed'],
      ['preferCompactDays', 'Compact-day preference changed'],
    ] as const;
    for (const [key, label] of labels) {
      if (JSON.stringify((prevPrefValue as any)[key]) !== JSON.stringify((currPrefValue as any)[key])) reasons.push(label);
    }
  }

  const hasStructuralCourseChange =
    deletedCourseNames.length > 0 || addedCourseNames.length > 0 || modifiedCourseNames.length > 0;

  return {
    isStale: true,
    reasons,
    deletedCourseNames,
    addedCourseNames,
    modifiedCourseNames,
    hasStructuralCourseChange,
    hasPreferenceChange,
  };
}

