import type { DayOfWeek, Section, Session, SessionType } from '../types';
import { resolveDayTokens, resolveSessionType } from './scheduleParsing';
import { normalizeMeetingType } from './meetingTypes';
import { normalizeTimeWithPolicy, parseTimeRangeWithPolicy, isAmbiguousBareTime } from './timeParsingPolicy';
import { cleanCourseTitle, extractCourseIdentityFromRaw, parseCourseCode, getCourseIdentityKey } from './courseUtils';
import {
  canonicalizeDisplaySectionCode,
  canonicalizeSectionIdentity,
  classifySectionCodeRelation,
  consolidateDerivedCompositeSections,
  detectCompositeDerivedCode,
  getCanonicalSectionKey,
  getResolvedSectionIdentity,
  isPlaceholderSectionId,
  mergeDuplicateCanonicalSections,
  parseCourseCodeStructure,
} from './courseCodeRelation';

export interface OCRReviewReason { code: string; detail?: string; }

export interface OCRRawMeeting {
  raw?: unknown;
  days?: unknown;
  day?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  start?: unknown;
  end?: unknown;
  time?: unknown;
  times?: unknown;
  meeting_time?: unknown;
  raw_time?: unknown;
  type?: unknown;
  meeting_type?: unknown;
  ambiguousTime?: unknown;
  ambiguous_time?: unknown;
  source_image_index?: unknown;
  source_record_index?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  [key: string]: unknown;
}

export interface OCRRawSection {
  section_code?: unknown;
  section_id?: unknown;
  section?: unknown;
  section_number?: unknown;
  id?: unknown;
  code?: unknown;
  course_code?: unknown;
  courseCode?: unknown;
  subject_code?: unknown;
  course_name?: unknown;
  course_title?: unknown;
  name?: unknown;
  title?: unknown;
  credit_hours?: unknown;
  credits?: unknown;
  credit_hours_conflict?: unknown;
  instructor?: unknown;
  tutorial_code?: unknown;
  part_time?: unknown;
  section_code_missing?: unknown;
  needs_review?: unknown;
  review_reasons?: unknown;
  meetings?: unknown;
  sessions?: unknown;
  meeting_times?: unknown;
  times?: unknown;
  conflicting_meetings?: unknown;
  raw_evidence?: unknown;
  source_image_index?: unknown;
  source_record_index?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
}

export interface OCRRawCourse {
  course_name?: unknown;
  course_title?: unknown;
  name?: unknown;
  title?: unknown;
  course?: unknown;
  course_code?: unknown;
  courseCode?: unknown;
  code?: unknown;
  subject?: unknown;
  subject_code?: unknown;
  credit_hours?: unknown;
  credits?: unknown;
  code_inferred?: unknown;
  credit_hours_conflict?: unknown;
  needs_review?: unknown;
  review_reasons?: unknown;
  sections?: unknown;
  classes?: unknown;
  meetings?: unknown;
  sessions?: unknown;
  meeting_times?: unknown;
  raw_evidence?: unknown;
  source_image_index?: unknown;
  source_record_index?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
}

export interface OCRIncompleteMeeting {
  raw: OCRRawMeeting;
  reasonCodes: string[];
  source?: {
    sourceChunkIndex?: number;
    sourceImageIndexes?: number[];
    sourceImageIndex?: number;
    model?: string;
    sourceRecordIndex?: number;
    ocrRunId?: string;
  };
}

export interface CanonicalOCRSection {
  courseName: string | null;
  courseCode: string | null;
  courseKey?: string;
  codeInferred: boolean;
  credits: number | null;
  creditConflict: number[] | null;
  sectionCode: string | null;
  rawSectionCode?: string | null;
  canonicalSectionKey?: string | null;
  rawSectionCodeVariants?: string[];
  sectionCodeRaw?: string | null;
  normalizedSectionIdentity?: string | null;
  sectionKey?: string | null;
  sectionRelationship?: string;
  sectionCodeMissing: boolean;
  sectionInternalId: string;
  instructor: string | null;
  tutorialCode: string | null;
  partTime: boolean | string | null;
  meetings: Session[];
  incompleteMeetings: OCRIncompleteMeeting[];
  conflictingMeetings: OCRRawMeeting[];
  needsReview: boolean;
  reviewReasons: OCRReviewReason[];
  rawEvidence: unknown[];
  sourceImageIndexes?: number[];
  ocrRunId?: string;
  courseCodeInferenceSource?: 'explicit_field' | 'labelled_text' | 'embedded_title' | 'unknown';
}

export interface OcrSourceMeta {
  sourceChunkIndex?: number;
  sourceImageIndexes?: number[];
  model?: string;
  ocrRunId?: string;
}

const DAY_ORDER: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const valueTrimmed = value.trim();
  return valueTrimmed ? valueTrimmed : null;
}

export function normalizeDisplayText(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeCourseCode(raw: unknown): string | null {
  const value = nonEmptyString(raw);
  if (!value) return null;
  const normalized = value
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // Course identity normalization is deliberately conservative. We only normalize
  // superficial spacing and dash variants here. Fused course+section strings are
  // handled separately by getFusedCourseSectionCode so section information cannot
  // be swallowed into the course identity.
  const clean = normalized
    .replace(/^([\p{L}\d]{2,12})\s*-\s*(\d{1,6}[A-Za-z]?)$/u, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || null;
}

export function normalizeCourseIdentity(code: string | null, name: string | null): string {
  const extracted = !code ? parseCourseCode(name || '') : null;
  return getCourseIdentityKey(code || extracted, name);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function validCredits(value: unknown): number | null {
  const numeric = numberValue(value);
  return numeric !== null && numeric >= 0 && numeric <= 17 ? numeric : null;
}

function parseCreditConflict(...sources: unknown[]): number[] {
  const values: number[] = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const value of source) {
        const numeric = validCredits(value);
        if (numeric !== null && !values.includes(numeric)) values.push(numeric);
      }
    } else {
      const numeric = validCredits(source);
      if (numeric !== null && !values.includes(numeric)) values.push(numeric);
    }
  }
  return values.sort((a, b) => a - b);
}

function toReviewReasons(value: unknown): OCRReviewReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ code: item.trim() }];
    if (item && typeof item === 'object') {
      const code = nonEmptyString((item as Record<string, unknown>).code);
      if (code) return [{ code, detail: nonEmptyString((item as Record<string, unknown>).detail) ?? undefined }];
    }
    return [];
  });
}

function mergeReviewReasons(target: OCRReviewReason[], incoming: OCRReviewReason[]) {
  const seen = new Set(target.map((reason) => `${reason.code}|${reason.detail ?? ''}`));
  for (const reason of incoming) {
    const key = `${reason.code}|${reason.detail ?? ''}`;
    if (!seen.has(key)) {
      target.push(reason);
      seen.add(key);
    }
  }
}

function dedupeReasons(reasons: OCRReviewReason[]): OCRReviewReason[] {
  const output: OCRReviewReason[] = [];
  mergeReviewReasons(output, reasons);
  return output;
}

function getMeetingArray(obj: any): OCRRawMeeting[] {
  if (!obj || typeof obj !== 'object') return [];
  for (const key of ['meetings', 'sessions', 'meeting_times', 'times']) {
    if (Array.isArray(obj[key])) return obj[key].filter((item: unknown) => item && typeof item === 'object');
  }
  if (obj.sessions && typeof obj.sessions === 'object' && !Array.isArray(obj.sessions)) return [obj.sessions];
  if (obj.day || obj.days || obj.start || obj.end || obj.start_time || obj.end_time || obj.time || obj.hours || obj.meeting_time) {
    return [{
      day: obj.day ?? obj.Day,
      days: obj.days,
      start: obj.start ?? obj.start_time,
      start_time: obj.start_time,
      end: obj.end ?? obj.end_time,
      end_time: obj.end_time,
      time: obj.time ?? obj.hours ?? obj.meeting_time,
      type: obj.type ?? obj.meeting_type,
      ambiguousTime: obj.ambiguousTime ?? obj.ambiguous_time,
      raw_time: obj.raw_time,
      source_image_index: obj.source_image_index,
      source_record_index: obj.source_record_index,
      confidence: obj.confidence,
      evidence: obj.evidence,
    }];
  }
  return [];
}

export function buildCourseKey(
  courseCode: string | null | undefined,
  courseName: string | null | undefined
): string {
  return getCourseIdentityKey(courseCode, courseName);
}

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

export function getLegacySectionCode(section: any): string | null {
  const explicit =
    section?.section_code ??
    section?.section_id ??
    section?.section ??
    section?.section_number;

  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  // `id` is an internal storage identity, never a visible section code.
  return null;
}

function getExplicitSectionCode(section: any): string | null {
  return getLegacySectionCode(section);
}

function normalizeSectionMeetings(section: any): any[] {
  if (Array.isArray(section?.meetings)) {
    return section.meetings.map((m: any) => ({
      day: typeof m?.day === 'string' ? m.day : null,
      start_time: typeof (m?.start_time ?? m?.start) === 'string' ? (m?.start_time ?? m?.start) : null,
      end_time: typeof (m?.end_time ?? m?.end) === 'string' ? (m?.end_time ?? m?.end) : null,
      type: typeof m?.type === 'string' ? m.type : null,
      ...(m?.raw_time ? { raw_time: String(m.raw_time) } : {}),
      ...(Number.isInteger(m?.source_image_index) ? { source_image_index: Number(m.source_image_index) } : {}),
      ...(Number.isInteger(m?.source_record_index) ? { source_record_index: Number(m.source_record_index) } : {}),
      ...(Number.isFinite(Number(m?.confidence)) ? { confidence: Number(m.confidence) } : {}),
      ...(m?.evidence !== undefined ? { evidence: m.evidence } : {}),
    }));
  }
  if (Array.isArray(section?.sessions)) {
    return section.sessions.map((sess: any) => ({
      day: typeof sess?.day === 'string' ? sess.day : null,
      start_time: typeof (sess?.start_time ?? sess?.start) === 'string' ? (sess?.start_time ?? sess?.start) : null,
      end_time: typeof (sess?.end_time ?? sess?.end) === 'string' ? (sess?.end_time ?? sess?.end) : null,
      type: typeof sess?.type === 'string' ? sess.type : null,
      ...(sess?.raw_time ? { raw_time: String(sess.raw_time) } : {}),
      ...(Number.isInteger(sess?.source_image_index) ? { source_image_index: Number(sess.source_image_index) } : {}),
      ...(Number.isInteger(sess?.source_record_index) ? { source_record_index: Number(sess.source_record_index) } : {}),
      ...(Number.isFinite(Number(sess?.confidence)) ? { confidence: Number(sess.confidence) } : {}),
      ...(sess?.evidence !== undefined ? { evidence: sess.evidence } : {}),
    }));
  }
  const day = typeof section?.day === 'string' ? section.day : null;
  let start_time = typeof (section?.start_time ?? section?.start) === 'string' ? (section?.start_time ?? section?.start) : null;
  let end_time = typeof (section?.end_time ?? section?.end) === 'string' ? (section?.end_time ?? section?.end) : null;
  if (!start_time && typeof section?.time === 'string') {
    const parsedRange = parseTimeRangeWithPolicy(section.time);
    if (parsedRange) {
      const s = normalizeTimeWithPolicy(parsedRange.rawStart, parsedRange.startPmContext);
      const e = normalizeTimeWithPolicy(parsedRange.rawEnd, parsedRange.endPmContext);
      if (s && e) {
        start_time = s;
        end_time = e;
      }
    }
  }
  if (day || start_time || end_time) {
    return [{
      day,
      start_time,
      end_time,
      type: typeof section?.type === 'string' ? section.type : null,
    }];
  }
  return [];
}

export function adaptLegacyOcrPayload(raw: any): { courses: any[] } {
  if (!raw || typeof raw !== 'object') return { courses: [] };

  if (Array.isArray(raw.courses)) {
    const normalizedCourses = raw.courses.map((course: any) => {
      if (!course || typeof course !== 'object') return course;
      const rawCourseCode = course.course_code ?? course.courseCode ?? course.code ?? null;
      const rawName = course.course_name ?? course.courseName ?? course.name ?? course.title ?? null;
      const sections = Array.isArray(course.sections) ? course.sections : [];
      return {
        ...course,
        course_name: typeof rawName === 'string' ? rawName.trim() : null,
        course_code: typeof rawCourseCode === 'string' ? rawCourseCode.trim() : null,
        sections: sections.map((s: any) => {
          if (!s || typeof s !== 'object') return s;
          const sectionCode = s.section_code ?? s.sectionCode ?? s.section ?? s.section_number ?? s.code ?? null;
          return {
            ...s,
            section_code: typeof sectionCode === 'string' ? sectionCode.trim() : (sectionCode !== null && sectionCode !== undefined ? String(sectionCode) : null),
            section_code_missing: Boolean(s.section_code_missing ?? !sectionCode),
            instructor: typeof s.instructor === 'string' ? s.instructor.trim() : (s.instructor ?? null),
            meetings: normalizeSectionMeetings(s),
            credits: typeof s.credits === 'number' && Number.isFinite(s.credits) ? s.credits : (typeof s.credit_hours === 'number' && Number.isFinite(s.credit_hours) ? s.credit_hours : null),
            needs_review: Boolean(s.needs_review),
            review_reasons: Array.isArray(s.review_reasons) ? s.review_reasons : [],
            conflicting_meetings: Array.isArray(s.conflicting_meetings) ? s.conflicting_meetings : [],
          };
        }),
      };
    });
    return { courses: normalizedCourses };
  }

  const legacySections = Array.isArray(raw.sections)
    ? raw.sections
    : Array.isArray(raw)
    ? raw
    : [];

  const adaptedCourses = legacySections.map((section: any) => {
    const rawSectionCode = getLegacySectionCode(section);
    const rawCourseCode =
      section?.course_code ??
      section?.courseCode ??
      section?.subject_code ??
      (typeof section?.course === 'object' ? (section.course?.code ?? section.course?.course_code) : null);
    const rawName = section?.name ?? section?.course_name ?? section?.title;

    const explicitCode = parseCourseCode(rawCourseCode || '');
    const courseCode = explicitCode;
    const name = typeof rawName === 'string' ? cleanCourseTitle(rawName, courseCode) || rawName.trim() : null;

    return {
      course_name: name,
      course_code: courseCode,
      sections: [{
        section_code: rawSectionCode,
        section_code_missing: !rawSectionCode,
        instructor: section?.instructor ?? null,
        meetings: normalizeSectionMeetings(section),
        credits: section?.credits ?? null,
        needs_review: false,
        review_reasons: [],
        conflicting_meetings: [],
      }],
    };
  });

  return { courses: adaptedCourses };
}

function looksLikeCourseCode(value: string): boolean {
  return /^(?:[A-Za-z]{2,8}|[\u0600-\u06FF]{2,8})\s*[-_]?\s*\d{1,6}(?:[A-Za-z])?$/u.test(value.trim());
}

function getFusedCourseSectionCode(value: unknown): { courseCode: string; sectionCode: string } | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[‐‑‒–—―]/g, '-');
  const ascii = clean.match(/^([A-Za-z]{2,8})\s*[-_]?\s*(\d{1,6}[A-Za-z]?)[-_]([A-Za-z0-9]{1,8}(?:[-_][A-Za-z0-9]{1,8})?)$/);
  if (ascii && !/^(?:AM|PM|ROOM|RM|BLDG|BUILDING|ID|PHONE|TEL|YEAR|DAY|CAMPUS)$/i.test(ascii[1])) {
    return { courseCode: `${ascii[1].toUpperCase()} ${ascii[2].toUpperCase()}`, sectionCode: ascii[3] };
  }
  const arabic = clean.match(/^([\u0600-\u06FF]{2,8})\s*[-_]?\s*(\d{1,6})[-_]([A-Za-z0-9]{1,8})$/u);
  if (arabic) return { courseCode: `${arabic[1]} ${arabic[2]}`, sectionCode: arabic[3] };
  return null;
}

function getCourseCodeDetailed(course: any, section?: any): { code: string | null; source: 'explicit_field' | 'labelled_text' | 'embedded_title' | 'unknown' } {
  const explicitCandidates = [
    course?.course_code, course?.courseCode, course?.subject_code,
    section?.course_code, section?.courseCode, section?.subject_code, course?.code,
  ];
  for (const candidate of explicitCandidates) {
    const fused = getFusedCourseSectionCode(candidate);
    if (fused) return { code: fused.courseCode, source: 'explicit_field' };
    const parsed = parseCourseCode(candidate);
    if (parsed) return { code: parsed, source: 'explicit_field' };
    const normalized = normalizeCourseCode(candidate);
    if (normalized && looksLikeCourseCode(normalized)) return { code: normalized, source: 'explicit_field' };
  }
  // A course title can contain a code-like token, but it is not authoritative identity
  // unless the provider explicitly supplied it in a code field. Preserve it as evidence.
  const titleCandidates = [course?.course_name, course?.course_title, course?.name, course?.title, section?.course_name, section?.course_title, section?.name, section?.title];
  for (const candidate of titleCandidates) {
    const fused = getFusedCourseSectionCode(candidate);
    if (fused) return { code: fused.courseCode, source: 'embedded_title' };
    const parsed = parseCourseCode(candidate);
    if (parsed) return { code: parsed, source: 'embedded_title' };
  }
  return { code: null, source: 'unknown' };
}

function getCourseCode(course: any, section?: any): string | null {
  return getCourseCodeDetailed(course, section).code;
}

function getCourseName(course: any, section?: any, courseCode?: string | null): string | null {
  const candidates = [
    course?.course_name,
    course?.course_title,
    course?.name,
    course?.title,
    course?.course,
    section?.course_name,
    section?.course_title,
    section?.name,
    section?.title,
  ];
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate);
    if (value && !looksLikeCourseCode(value)) {
      const cleaned = cleanCourseTitle(value, courseCode);
      return normalizeDisplayText(cleaned || value);
    }
  }
  return null;
}

function parseMeetingDays(raw: unknown): DayOfWeek[] {
  if (Array.isArray(raw)) return uniqueDays(raw.flatMap((value) => resolveDayTokens(String(value))));
  return uniqueDays(resolveDayTokens(String(raw ?? '')));
}

function uniqueDays(days: DayOfWeek[]): DayOfWeek[] {
  const present = new Set(days);
  return DAY_ORDER.filter((day) => present.has(day));
}

function rawTimePair(meeting: OCRRawMeeting): { startRaw: string; endRaw: string; rangeRaw: string } {
  const explicitStart = nonEmptyString(meeting.start_time ?? meeting.start) ?? '';
  const explicitEnd = nonEmptyString(meeting.end_time ?? meeting.end) ?? '';
  const rangeRaw = nonEmptyString(meeting.raw_time ?? meeting.time ?? meeting.times ?? meeting.meeting_time) ?? '';
  return { startRaw: explicitStart, endRaw: explicitEnd, rangeRaw };
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizedSourceImageIndex(value: unknown, source: OcrSourceMeta): number | undefined {
  if (!Number.isInteger(value) || (value as number) < 0) return undefined;
  const index = Number(value);
  const allowed = source.sourceImageIndexes || [];
  return allowed.includes(index) ? index : undefined;
}

function collectSourceImageIndexes(rawObject: any, rawMeetings: OCRRawMeeting[], source: OcrSourceMeta): number[] {
  const values = new Set<number>();
  const sectionIndex = normalizedSourceImageIndex(rawObject?.source_image_index, source);
  if (sectionIndex !== undefined) values.add(sectionIndex);
  for (const meeting of rawMeetings) {
    const meetingIndex = normalizedSourceImageIndex(meeting?.source_image_index, source);
    if (meetingIndex !== undefined) values.add(meetingIndex);
  }
  return Array.from(values).sort((a, b) => a - b);
}

function normalizedMeetingEvidence(meeting: OCRRawMeeting, reasons: OCRReviewReason[]): OCRIncompleteMeeting {
  return {
    raw: { ...meeting },
    reasonCodes: dedupeReasons(reasons).map((reason) => reason.code),
  };
}

function normalizeMeeting(meeting: OCRRawMeeting): { sessions: Session[]; reasons: OCRReviewReason[]; incomplete?: OCRIncompleteMeeting } {
  const reasons: OCRReviewReason[] = [];
  const daysRaw = Array.isArray(meeting.days) ? meeting.days : (meeting.days ?? meeting.day ?? '');
  const days = parseMeetingDays(daysRaw);
  if (!days.length) reasons.push({ code: 'day_missing_or_unrecognized' });

  const { startRaw: explicitStart, endRaw: explicitEnd, rangeRaw } = rawTimePair(meeting);
  const contextualRangeRaw = rangeRaw || (explicitStart && explicitEnd ? `${explicitStart} - ${explicitEnd}` : '');

  let startRaw = explicitStart;
  let endRaw = explicitEnd;
  let startPmContext = false;
  let endPmContext = false;
  let rangeResolvedContext = false;

  if (contextualRangeRaw) {
    const range = parseTimeRangeWithPolicy(contextualRangeRaw);
    if (range) {
      startRaw = range.rawStart;
      endRaw = range.rawEnd;
      startPmContext = range.startPmContext;
      endPmContext = range.endPmContext;
      rangeResolvedContext = range.startPmContext || range.endPmContext || /\b(?:am|pm)\b/i.test(range.rawStart) || /\b(?:am|pm)\b/i.test(range.rawEnd);
    }
  }

  const start = startRaw ? normalizeTimeWithPolicy(startRaw, startPmContext) : null;
  const end = endRaw ? normalizeTimeWithPolicy(endRaw, endPmContext) : null;

  if (!start) reasons.push({ code: 'start_time_missing_or_unrecognized' });
  if (!end) reasons.push({ code: 'end_time_missing_or_unrecognized' });
  if (start && end && timeMinutes(start) >= timeMinutes(end)) {
    reasons.push({ code: 'invalid_time_order', detail: `${start}-${end}` });
  }

  const explicitAmbiguous = meeting.ambiguousTime ?? meeting.ambiguous_time;
  const ambiguousTime = explicitAmbiguous !== undefined
    ? Boolean(explicitAmbiguous)
    : !rangeResolvedContext && Boolean((startRaw && isAmbiguousBareTime(startRaw)) || (endRaw && isAmbiguousBareTime(endRaw)));
  if (ambiguousTime) {
    reasons.push({ code: 'ambiguous_meeting_time' });
    reasons.push({ code: 'ambiguous_time' });
  }

  const rawType = nonEmptyString(meeting.type ?? meeting.meeting_type);
  const meetingType = normalizeMeetingType(rawType);
  const resolvedType = (meetingType.type === 'Custom' ? 'Custom' : resolveSessionType(meetingType.type)) as SessionType;
  if (!rawType) reasons.push({ code: 'meeting_type_missing' });
  if (meetingType.type === 'Custom') reasons.push({ code: 'meeting_type_unrecognized', detail: rawType ?? undefined });

  if (!days.length || !start || !end || timeMinutes(start) >= timeMinutes(end) || ambiguousTime) {
    return { sessions: [], reasons, incomplete: normalizedMeetingEvidence(meeting, reasons) };
  }

  const sessions: Session[] = days.map((day) => ({
    day,
    start,
    end,
    type: resolvedType,
    ...(meetingType.customType ? { customType: meetingType.customType } : {}),
    ambiguousTime,
  }));
  return { sessions, reasons };
}

function meetingKey(session: Session): string {
  return `${session.day}|${session.start}|${session.end}|${session.type || 'Other'}|${Boolean(session.ambiguousTime)}`;
}

function rawMeetingKey(meeting: any): string {
  if (!meeting || typeof meeting !== 'object') return '';
  const day = String(meeting.day ?? meeting.days ?? '').trim().toUpperCase();
  const start = String(meeting.start_time ?? meeting.start ?? '').trim();
  const end = String(meeting.end_time ?? meeting.end ?? '').trim();
  const type = String(meeting.type ?? meeting.meeting_type ?? 'Other').trim().toLowerCase();
  return `${day}|${start}|${end}|${type}`;
}

function buildInternalId(courseCode: string | null, courseName: string | null, sectionCode: string | null, occurrence: number): string {
  const course = (courseCode || courseName || 'course').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 80) || 'course';
  const section = sectionCode ? sectionCode.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 50) : `missing_${occurrence + 1}`;
  return `ocr:${course}:${section}:${occurrence}`;
}

function normalizeCanonicalSection(
  rawObject: any,
  rawMeetings: OCRRawMeeting[],
  courseName: string | null,
  courseCode: string | null,
  credits: number | null,
  creditConflict: number[] | null,
  initialReasons: OCRReviewReason[],
  source: OcrSourceMeta,
  occurrence: number,
  forcedSectionCode?: string | null,
  forcedMissing?: boolean,
  metadata?: {
    rawSectionCode?: string | null;
    sectionCodeRaw?: string | null;
    normalizedSectionIdentity?: string | null;
    sectionKey?: string | null;
    sectionRelationship?: string;
    courseCodeInferenceSource?: 'explicit_field' | 'labelled_text' | 'embedded_title' | 'unknown';
  }
): CanonicalOCRSection {
  const candidateCode = forcedSectionCode !== undefined ? forcedSectionCode : getExplicitSectionCode(rawObject);
  const isPlaceholder = isPlaceholderSectionId(candidateCode);
  const cleanCandidate = candidateCode?.trim() || null;
  const resolvedCode = (isPlaceholder || !cleanCandidate) ? null : cleanCandidate;
  const resolvedMissing = forcedMissing !== undefined ? forcedMissing : !resolvedCode;

  const rawSectionCode = cleanCandidate;
  const sectionCodeRaw = cleanCandidate;
  const canonicalSectionKey = resolvedCode ? canonicalizeSectionIdentity(resolvedCode) : null;
  const displaySectionCode = resolvedCode ? canonicalizeDisplaySectionCode(resolvedCode) : null;
  const normalizedSectionIdentity = canonicalSectionKey || resolvedCode;
  const sectionKey = canonicalSectionKey ? `VISIBLE:${canonicalSectionKey}` : (resolvedCode ? `VISIBLE:${resolvedCode.toUpperCase()}` : null);
  const sectionRelationship = 'standard';

  const finalSectionCode = metadata?.rawSectionCode !== undefined
    ? (metadata.rawSectionCode ? (canonicalizeDisplaySectionCode(metadata.rawSectionCode) || metadata.rawSectionCode) : null)
    : (resolvedCode ? (displaySectionCode || resolvedCode) : null);
  const finalRawCode = metadata?.rawSectionCode !== undefined ? metadata.rawSectionCode : rawSectionCode;
  const finalCanonicalKey = metadata?.rawSectionCode !== undefined
    ? (metadata.rawSectionCode ? canonicalizeSectionIdentity(metadata.rawSectionCode) : null)
    : canonicalSectionKey;
  const finalNormIdentity = metadata?.normalizedSectionIdentity !== undefined
    ? metadata.normalizedSectionIdentity
    : (finalCanonicalKey || normalizedSectionIdentity);
  const finalSectionKey = metadata?.sectionKey !== undefined
    ? metadata.sectionKey
    : (finalCanonicalKey ? `VISIBLE:${finalCanonicalKey}` : sectionKey);
  const finalRelationship = metadata?.sectionRelationship !== undefined ? metadata.sectionRelationship : sectionRelationship;
  const sectionMissing = metadata ? (!metadata.rawSectionCode && resolvedMissing) : resolvedMissing;

  const meetings: Session[] = [];
  const incompleteMeetings: OCRIncompleteMeeting[] = [];
  const conflictRaw: OCRRawMeeting[] = Array.isArray(rawObject?.conflicting_meetings) ? rawObject.conflicting_meetings.filter((item: unknown) => item && typeof item === 'object') : [];
  const reasons = [...initialReasons];
  const rawEvidence: unknown[] = [];

  if (sectionMissing) mergeReviewReasons(reasons, [{ code: 'section_code_missing' }]);
  if (creditConflict && creditConflict.length > 1) mergeReviewReasons(reasons, [{ code: 'credit_conflict' }]);
  if (conflictRaw.length) mergeReviewReasons(reasons, [{ code: 'conflicting_meeting' }]);

  for (const rawMeeting of rawMeetings) {
    const normalized = normalizeMeeting(rawMeeting);
    if (normalized.reasons.length) mergeReviewReasons(reasons, normalized.reasons);
    if (normalized.incomplete) {
      normalized.incomplete.source = {
        sourceChunkIndex: source.sourceChunkIndex,
        sourceImageIndexes: source.sourceImageIndexes,
        sourceImageIndex: normalizedSourceImageIndex(rawMeeting.source_image_index, source),
        model: source.model,
        sourceRecordIndex: Number.isInteger(rawMeeting.source_record_index) ? Number(rawMeeting.source_record_index) : occurrence,
        ocrRunId: source.ocrRunId,
      };
      incompleteMeetings.push(normalized.incomplete);
    }
    for (const session of normalized.sessions) {
      rawEvidence.push({
        sourceChunkIndex: source.sourceChunkIndex ?? null,
        sourceImageIndexes: collectSourceImageIndexes(rawObject, [rawMeeting], source),
        corpusImageIndexes: source.sourceImageIndexes ?? [],
        sourceImageIndex: normalizedSourceImageIndex(rawMeeting.source_image_index ?? rawObject?.source_image_index, source) ?? null,
        model: source.model ?? null,
        sourceRecordIndex: Number.isInteger(rawMeeting.source_record_index) ? Number(rawMeeting.source_record_index) : occurrence,
        ocrRunId: source.ocrRunId ?? null,
        meeting: rawMeeting,
      });
      if (!meetings.some((existing) => meetingKey(existing) === meetingKey(session))) meetings.push(session);
    }
  }

  for (const conflict of conflictRaw) {
    rawEvidence.push({
      sourceChunkIndex: source.sourceChunkIndex ?? null,
      sourceImageIndexes: collectSourceImageIndexes(rawObject, [conflict], source),
      corpusImageIndexes: source.sourceImageIndexes ?? [],
      sourceImageIndex: normalizedSourceImageIndex((conflict as any)?.source_image_index ?? rawObject?.source_image_index, source) ?? null,
      model: source.model ?? null,
      sourceRecordIndex: Number.isInteger((conflict as any)?.source_record_index) ? Number((conflict as any).source_record_index) : occurrence,
      ocrRunId: source.ocrRunId ?? null,
      conflict: true,
      meeting: conflict,
    });
  }

  rawEvidence.push({
    sourceChunkIndex: source.sourceChunkIndex ?? null,
    sourceImageIndexes: collectSourceImageIndexes(rawObject, rawMeetings, source),
    corpusImageIndexes: source.sourceImageIndexes ?? [],
    sourceImageIndex: normalizedSourceImageIndex(rawObject?.source_image_index, source) ?? null,
    model: source.model ?? null,
    sourceRecordIndex: Number.isInteger(rawObject?.source_record_index) ? Number(rawObject.source_record_index) : occurrence,
    ocrRunId: source.ocrRunId ?? null,
    object: rawObject,
  });

  const internalId = buildInternalId(courseCode, courseName, finalSectionCode || finalRawCode, occurrence);
  const effectiveSectionKey = finalSectionKey || (finalNormIdentity ? `VISIBLE:${finalNormIdentity}` : `MISSING:${internalId}`);

  return {
    courseName,
    courseCode,
    courseKey: buildCourseKey(courseCode, courseName),
    codeInferred: Boolean(rawObject?.code_inferred),
    credits: creditConflict && creditConflict.length > 1 ? null : credits,
    creditConflict: creditConflict && creditConflict.length > 1 ? creditConflict : null,
    sectionCode: finalSectionCode || null,
    rawSectionCode: finalRawCode || null,
    canonicalSectionKey: finalCanonicalKey || null,
    rawSectionCodeVariants: finalRawCode ? [finalRawCode] : [],
    sectionCodeRaw: finalRawCode || null,
    normalizedSectionIdentity: finalNormIdentity || null,
    sectionKey: effectiveSectionKey,
    sectionRelationship: finalRelationship,
    sectionCodeMissing: sectionMissing,
    sectionInternalId: internalId,
    sourceImageIndexes: collectSourceImageIndexes(rawObject, rawMeetings, source),
    ocrRunId: source.ocrRunId,
    instructor: nonEmptyString(rawObject?.instructor),
    tutorialCode: nonEmptyString(rawObject?.tutorial_code),
    partTime: typeof rawObject?.part_time === 'boolean' || typeof rawObject?.part_time === 'string' ? rawObject.part_time : null,
    meetings,
    incompleteMeetings,
    conflictingMeetings: conflictRaw,
    needsReview: Boolean(rawObject?.needs_review) || reasons.length > 0,
    reviewReasons: dedupeReasons(reasons),
    rawEvidence,
    courseCodeInferenceSource: metadata?.courseCodeInferenceSource || (rawObject?.code_inferred ? 'embedded_title' : 'unknown'),
  };
}

export function modelOutputToCanonical(rawParsed: any, source: OcrSourceMeta = {}): CanonicalOCRSection[] {
  if (!rawParsed || typeof rawParsed !== 'object') return [];

  const normalizedInput = Array.isArray(rawParsed.courses)
    ? rawParsed
    : adaptLegacyOcrPayload(rawParsed);

  if (!Array.isArray(normalizedInput.courses)) return [];
  const items: CanonicalOCRSection[] = [];
  let occurrence = 0;

  for (const rawCourse of normalizedInput.courses as OCRRawCourse[]) {
    const course = rawCourse || {};
    const courseName = getCourseName(course);
    const courseIdentityResult = getCourseCodeDetailed(course);
    const courseCode = courseIdentityResult.code;
    const courseCredits = validCredits(course.credit_hours ?? course.credits);
    const courseConflict = parseCreditConflict(course.credit_hours_conflict, courseCredits);
    const baseReasons = toReviewReasons(course.review_reasons);
    if (!courseName) baseReasons.push({ code: 'course_name_missing' });
    if (!courseCode) baseReasons.push({ code: 'course_code_missing' });
    if (courseIdentityResult.source === 'embedded_title') baseReasons.push({ code: 'course_code_embedded_in_title' });

    const rawSections = Array.isArray(course.sections) ? course.sections : Array.isArray(course.classes) ? course.classes : [];
    const explicitCourseFieldCode = [course.course_code, course.courseCode, course.subject_code, course.code].some((value) => {
      const normalized = normalizeCourseCode(value);
      return Boolean(normalized && looksLikeCourseCode(normalized));
    });
    const embeddedCodeCorroborated = explicitCourseFieldCode || rawSections.length > 1;
    if (courseIdentityResult.source === 'embedded_title' && !embeddedCodeCorroborated) {
      baseReasons.push({ code: 'course_code_embedded_title_uncorroborated' });
    }
    if (!rawSections.length) {
      const meetings = getMeetingArray(course);
      if (courseName || courseCode || meetings.length || courseCredits !== null) {
        items.push(normalizeCanonicalSection(
          { ...course, code_inferred: Boolean(course.code_inferred) },
          meetings,
          courseName,
          embeddedCodeCorroborated ? courseCode : null,
          courseCredits,
          courseConflict.length > 1 ? courseConflict : null,
          baseReasons,
          source,
          occurrence++,
          null,
          true,
          { courseCodeInferenceSource: courseIdentityResult.source },
        ));
      }
      continue;
    }

    const courseLevelMeetings = rawSections.length === 1 ? getMeetingArray(course) : [];
    const orphanCourseMeetings = rawSections.length > 1 ? getMeetingArray(course) : [];

    for (const rawSection of rawSections as OCRRawSection[]) {
      const section = rawSection || {};
      const explicitSectionCode = getExplicitSectionCode(section);
      const fusedSource = section.course_code ?? section.courseCode ?? course.course_code ?? course.courseCode;
      const fused = getFusedCourseSectionCode(fusedSource);
      const rawCandidate = explicitSectionCode || fused?.sectionCode || null;
      const sectionIdentityResult = getCourseCodeDetailed(course, section);
      const sectionCourseCode = (sectionIdentityResult.source === 'embedded_title' && !embeddedCodeCorroborated)
        ? (fused?.courseCode || (explicitCourseFieldCode ? courseCode : null))
        : (sectionIdentityResult.code || fused?.courseCode || courseCode);
      const sectionCourseName = getCourseName(course, section, sectionCourseCode) || cleanCourseTitle(courseName, sectionCourseCode);
      const sectionCredits = validCredits(section.credit_hours ?? section.credits);
      const creditValues = parseCreditConflict(courseConflict, sectionCredits, section.credit_hours_conflict);
      const reasons = [...baseReasons, ...toReviewReasons(section.review_reasons)];

      const rel = classifySectionCodeRelation(sectionCourseCode, rawCandidate);
      let candidateSectionCode = rawCandidate;
      let candidateMissing = !rawCandidate;
      let normSecIdentity: string | null = null;
      let secKey: string | null = null;

      if (rel.kind === 'exact-course-code-alias') {
        candidateSectionCode = null;
        candidateMissing = true;
      } else if (rel.kind === 'derived-section') {
        candidateSectionCode = rawCandidate ? (canonicalizeDisplaySectionCode(rawCandidate) || rawCandidate) : null;
        candidateMissing = false;
        normSecIdentity = rel.sectionNumber ? canonicalizeSectionIdentity(rel.sectionNumber) : (rawCandidate ? canonicalizeSectionIdentity(rawCandidate) : null);
        secKey = `DERIVED:${rel.sectionNumber}`;
      } else if (rel.kind === 'independent-section') {
        candidateSectionCode = rawCandidate ? (canonicalizeDisplaySectionCode(rawCandidate) || rawCandidate) : null;
        candidateMissing = !rawCandidate;
        normSecIdentity = rawCandidate ? canonicalizeSectionIdentity(rawCandidate) : null;
        secKey = normSecIdentity ? `VISIBLE:${normSecIdentity}` : null;
      } else if (rel.kind === 'unrelated-course-code') {
        candidateSectionCode = null;
        candidateMissing = true;
      }

      if (candidateMissing) reasons.push({ code: 'section_code_missing' });
      if (Boolean(section.section_code_missing) && candidateSectionCode) reasons.push({ code: 'section_code_missing_flag_conflict' });
      if (Boolean(section.needs_review)) reasons.push({ code: 'model_flagged_review' });
      const meetings = [...getMeetingArray(section), ...courseLevelMeetings];

      items.push(normalizeCanonicalSection(
        { ...section, code_inferred: Boolean(course.code_inferred) },
        meetings,
        sectionCourseName,
        sectionCourseCode,
        sectionCredits ?? courseCredits,
        creditValues.length > 1 ? creditValues : null,
        reasons,
        source,
        occurrence++,
        candidateSectionCode,
        candidateMissing,
        {
          rawSectionCode: rawCandidate,
          sectionCodeRaw: rawCandidate,
          normalizedSectionIdentity: normSecIdentity,
          sectionKey: secKey,
          sectionRelationship: rel.kind,
          courseCodeInferenceSource: sectionIdentityResult.source,
        }
      ));
    }

    if (orphanCourseMeetings.length) {
      items.push(normalizeCanonicalSection(
        { ...course, code_inferred: Boolean(course.code_inferred) },
        orphanCourseMeetings,
        courseName,
        embeddedCodeCorroborated ? courseCode : null,
        courseCredits,
        courseConflict.length > 1 ? courseConflict : null,
        [...baseReasons, { code: 'course_level_meeting_with_multiple_sections' }, { code: 'section_code_missing' }],
        source,
        occurrence++,
        null,
        true,
        { courseCodeInferenceSource: courseIdentityResult.source },
      ));
    }
  }
  return items;
}

export function canonicalToAppSections(items: CanonicalOCRSection[]): Section[] {
  return items.map((item) => ({
    id: item.sectionInternalId,
    name: item.courseName || '',
    courseKey: normalizeCourseIdentity(item.courseCode, item.courseName),
    courseCode: item.courseCode,
    sectionCode: item.sectionCode,
    rawSectionCode: item.rawSectionCode ?? item.sectionCode,
    canonicalSectionKey: item.canonicalSectionKey ?? (item.rawSectionCode ? canonicalizeSectionIdentity(item.rawSectionCode) : null),
    rawSectionCodeVariants: item.rawSectionCodeVariants || (item.rawSectionCode ? [item.rawSectionCode] : []),
    sectionCodeRaw: item.sectionCodeRaw ?? item.rawSectionCode ?? item.sectionCode,
    normalizedSectionIdentity: item.normalizedSectionIdentity ?? null,
    sectionKey: item.sectionKey ?? null,
    sectionRelationship: item.sectionRelationship,
    sectionCodeMissing: item.sectionCodeMissing,
    credits: item.credits,
    sessions: item.meetings.map((meeting, index) => ({
      ...meeting,
      id: `ocr-session:${item.sectionInternalId}:${index}`,
      sourceEvidence: {
        sourceImageIndexes: item.sourceImageIndexes || [],
        ocrRunId: item.ocrRunId,
      },
    })),
    instructor: item.instructor,
    tutorialCode: item.tutorialCode,
    partTime: item.partTime,
    needsReview: item.needsReview,
    reviewReasons: item.reviewReasons.map((reason) => reason.detail ? `${reason.code}:${reason.detail}` : reason.code),
    conflictingMeetings: item.conflictingMeetings,
    creditHoursConflict: item.creditConflict,
    rawOcrEvidence: [...item.rawEvidence, ...(item.incompleteMeetings.length ? [{ incompleteMeetings: item.incompleteMeetings }] : [])],
    codeInferred: item.codeInferred,
    courseCodeInferenceSource: item.courseCodeInferenceSource,
    sourceImageIndexes: item.sourceImageIndexes || [],
    ocrRunId: item.ocrRunId,
    incompleteMeetings: item.incompleteMeetings,
  }));
}

function courseIdentity(section: Section): string {
  const code = typeof section.courseCode === 'string' ? section.courseCode.trim() : '';
  if (code) return `code:${code.toUpperCase().replace(/[\s_-]+/g, '')}`;
  return `name:${normalizeDisplayText(section.name).toLowerCase().replace(/\s+/g, ' ')}`;
}

function explicitSectionIdentity(section: Section): string | null {
  const resolved = getResolvedSectionIdentity(section);
  return resolved ? `resolved:${resolved.toLowerCase()}` : null;
}

function cloneSection(section: Section): Section {
  return {
    ...section,
    name: normalizeDisplayText(section.name),
    rawSectionCode: section.rawSectionCode ?? section.sectionCode,
    sectionCodeRaw: section.sectionCodeRaw ?? section.rawSectionCode ?? section.sectionCode,
    normalizedSectionIdentity: section.normalizedSectionIdentity ?? null,
    sectionKey: section.sectionKey ?? null,
    sectionRelationship: section.sectionRelationship,
    sessions: [...(section.sessions || [])],
    incompleteMeetings: section.incompleteMeetings ? section.incompleteMeetings.map((meeting) => ({
      raw: meeting.raw,
      reasonCodes: [...meeting.reasonCodes],
      source: meeting.source ? {
        ...meeting.source,
        sourceImageIndexes: meeting.source.sourceImageIndexes ? [...meeting.source.sourceImageIndexes] : undefined,
      } : undefined,
    })) : [],
    reviewReasons: [...(section.reviewReasons || [])],
    conflictingMeetings: [...(section.conflictingMeetings || [])],
    creditHoursConflict: section.creditHoursConflict ? [...section.creditHoursConflict] : null,
    rawOcrEvidence: [...(section.rawOcrEvidence || [])],
    sourceImageIndexes: section.sourceImageIndexes ? [...section.sourceImageIndexes] : [],
    ocrRunId: section.ocrRunId,
    courseCodeInferenceSource: section.courseCodeInferenceSource,
    reviewAcknowledged: Boolean(section.reviewAcknowledged),
  };
}

function addCourseNameEvidence(target: Section, incoming: Section): void {
  if (!target.name && incoming.name) {
    target.name = incoming.name;
    return;
  }
  if (target.name && incoming.name) {
    const targetNorm = normalizeDisplayText(target.name).toLowerCase();
    const incomingNorm = normalizeDisplayText(incoming.name).toLowerCase();
    if (targetNorm !== incomingNorm) {
      if (incoming.name.length > target.name.length && incomingNorm.includes(targetNorm.slice(0, Math.min(8, targetNorm.length)))) {
        target.name = incoming.name;
      }
      target.needsReview = true;
      target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), 'course_name_conflict']));
      target.rawOcrEvidence = [
        ...(target.rawOcrEvidence || []),
        { course_name_conflict: { existing: target.name, incoming: incoming.name } },
      ];
    }
  }
}

function mergeCreditState(target: Section, incoming: Section): void {
  const values = new Set<number>();
  for (const value of target.creditHoursConflict || []) if (Number.isFinite(Number(value))) values.add(Number(value));
  for (const value of incoming.creditHoursConflict || []) if (Number.isFinite(Number(value))) values.add(Number(value));
  if (target.credits != null && Number.isFinite(Number(target.credits))) values.add(Number(target.credits));
  if (incoming.credits != null && Number.isFinite(Number(incoming.credits))) values.add(Number(incoming.credits));

  if (values.size > 1) {
    target.credits = null;
    target.creditHoursConflict = Array.from(values).sort((a, b) => a - b);
    target.needsReview = true;
    target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), 'credit_conflict']));
  } else if (target.credits == null && incoming.credits != null && !target.creditHoursConflict?.length) {
    target.credits = incoming.credits;
  }
}

function pushUniqueConflict(target: Section, meeting: OCRRawMeeting): void {
  const list = target.conflictingMeetings || (target.conflictingMeetings = []);
  const key = rawMeetingKey(meeting);
  if (!list.some((candidate) => rawMeetingKey(candidate) === key)) list.push(meeting);
}

export function mergeSectionLosslessly(target: Section, incoming: Section): void {
  addCourseNameEvidence(target, incoming);
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

  mergeCreditState(target, incoming);

  const targetIncomplete = target.incompleteMeetings || (target.incompleteMeetings = []);
  for (const incomingIncomplete of incoming.incompleteMeetings || []) {
    const key = JSON.stringify(incomingIncomplete.raw);
    if (!targetIncomplete.some((candidate) => JSON.stringify(candidate.raw) === key && JSON.stringify(candidate.reasonCodes) === JSON.stringify(incomingIncomplete.reasonCodes))) {
      targetIncomplete.push(incomingIncomplete);
    }
  }

  target.conflictingMeetings = [...(target.conflictingMeetings || [])];
  for (const incomingSession of incoming.sessions || []) {
    const exact = target.sessions.some((existing) => meetingKey(existing) === meetingKey(incomingSession));
    if (exact) continue;

    const sameContextIndex = target.sessions.findIndex((existing) =>
      existing.day === incomingSession.day && (existing.type || 'Other') === (incomingSession.type || 'Other')
    );
    if (sameContextIndex >= 0) {
      const existing = target.sessions[sameContextIndex];
      const existingStart = timeMinutes(existing.start);
      const existingEnd = timeMinutes(existing.end);
      const incomingStart = timeMinutes(incomingSession.start);
      const incomingEnd = timeMinutes(incomingSession.end);
      const overlaps = existingStart < incomingEnd && incomingStart < existingEnd;
      // Meeting identity is exact. Same-day/type with different non-overlapping times can
      // legitimately be two meetings; retain both and flag the unusual shape for review.
      // Overlapping observations are retained too, because discarding either side loses OCR evidence.
      target.sessions.push(incomingSession);
      const reason = overlaps ? 'overlapping_same_day_and_type' : 'multiple_same_day_and_type';
      pushUniqueConflict(target, {
        day: incomingSession.day,
        start_time: existing.start,
        end_time: existing.end,
        type: existing.type,
        reason,
      });
      pushUniqueConflict(target, {
        day: incomingSession.day,
        start_time: incomingSession.start,
        end_time: incomingSession.end,
        type: incomingSession.type,
        reason,
      });
      target.needsReview = true;
      const reviewCode = overlaps ? 'conflicting_meeting' : 'multiple_same_day_and_type';
      target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), reviewCode]));
    } else {
      target.sessions.push(incomingSession);
    }
  }

  for (const conflict of incoming.conflictingMeetings || []) pushUniqueConflict(target, conflict as OCRRawMeeting);

  target.reviewReasons = Array.from(new Set([...(target.reviewReasons || []), ...(incoming.reviewReasons || [])]));
  target.sourceImageIndexes = Array.from(new Set([...(target.sourceImageIndexes || []), ...(incoming.sourceImageIndexes || [])])).sort((a, b) => a - b);
  if (!target.ocrRunId && incoming.ocrRunId) target.ocrRunId = incoming.ocrRunId;
  if (!target.courseCodeInferenceSource && incoming.courseCodeInferenceSource) target.courseCodeInferenceSource = incoming.courseCodeInferenceSource;
  target.rawOcrEvidence = [...(target.rawOcrEvidence || []), ...(incoming.rawOcrEvidence || [])];
  target.needsReview = Boolean(target.needsReview || incoming.needsReview || target.conflictingMeetings.length || target.incompleteMeetings.length);
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

function scoreMissingSectionAssociation(missing: Section, candidate: Section): number {
  if (courseIdentity(missing) !== courseIdentity(candidate)) return -1;
  let score = 0;
  const candidateMeetings = candidate.sessions || [];
  const missingMeetings = missing.sessions || [];
  const exactMeetingMatches = missingMeetings.filter((incoming) => candidateMeetings.some((existing) => meetingKey(existing) === meetingKey(incoming))).length;
  score += exactMeetingMatches * 5;

  const missingRawMeetings = (missing.incompleteMeetings || []).map((m) => rawMeetingKey(m.raw)).filter(Boolean);
  const candidateRawMeetings = (candidate.incompleteMeetings || []).map((m) => rawMeetingKey(m.raw)).filter(Boolean);
  score += missingRawMeetings.filter((key) => candidateRawMeetings.includes(key)).length * 2;

  if (missing.instructor && candidate.instructor && normalizeDisplayText(missing.instructor).toLowerCase() === normalizeDisplayText(candidate.instructor).toLowerCase()) score += 2;
  if (missing.credits != null && candidate.credits != null && Number(missing.credits) === Number(candidate.credits)) score += 2;

  const sourceOverlap = (missing.sourceImageIndexes || []).filter((index) => (candidate.sourceImageIndexes || []).includes(index)).length;
  score += sourceOverlap * 2;

  const missingVariants = new Set((missing.rawSectionCodeVariants || []).map((v) => canonicalizeSectionIdentity(v)));
  const candidateVariants = new Set((candidate.rawSectionCodeVariants || []).map((v) => canonicalizeSectionIdentity(v)));
  if ([...missingVariants].some((v) => candidateVariants.has(v))) score += 2;
  return score;
}

function missingSectionFingerprint(section: Section): string {
  return JSON.stringify({
    course: courseIdentity(section),
    name: normalizeDisplayText(section.name).toLowerCase(),
    sessions: (section.sessions || []).map(meetingKey).sort(),
    incomplete: (section.incompleteMeetings || []).map((meeting) => ({ raw: meeting.raw, reasons: meeting.reasonCodes })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    conflicts: (section.conflictingMeetings || []).map((meeting) => JSON.stringify(meeting)).sort(),
    credits: section.credits ?? null,
    creditConflict: section.creditHoursConflict || null,
    instructor: section.instructor ?? null,
  });
}

export function reconcileOCRSections(sections: Section[]): Section[] {
  // Step 1: Clone and extract identity
  const cloned = (sections || []).map((raw) => cloneSection(raw));

  // Step 2: Map title-only records to coded courses if unique match exists (Section 15 partial view merge)
  const titleToCodedKeyMap = new Map<string, Set<string>>();
  const codedCoursesInfo = new Map<string, { code: string; name: string }>();

  for (const s of cloned) {
    courseIdentity(s); // ensures courseCode and clean name resolved
    if (s.courseCode && s.name) {
      const normTitle = normalizeDisplayText(s.name).toLowerCase();
      const codeKey = getCourseIdentityKey(s.courseCode, s.name);
      const set = titleToCodedKeyMap.get(normTitle) || new Set<string>();
      set.add(codeKey);
      titleToCodedKeyMap.set(normTitle, set);
      if (!codedCoursesInfo.has(codeKey)) {
        codedCoursesInfo.set(codeKey, { code: s.courseCode, name: s.name });
      }
    }
  }

  for (const s of cloned) {
    if (!s.courseCode && s.name) {
      const normTitle = normalizeDisplayText(s.name).toLowerCase();
      const matchingCodes = titleToCodedKeyMap.get(normTitle);
      if (matchingCodes && matchingCodes.size === 1) {
        const targetKey = Array.from(matchingCodes)[0];
        const info = codedCoursesInfo.get(targetKey);
        if (info) {
          s.courseCode = info.code;
          s.codeInferred = true;
        }
      }
    }
  }

  // Step 3: Group by course identity
  const byCourse = new Map<string, Section[]>();
  for (const copy of cloned) {
    const key = courseIdentity(copy);
    const list = byCourse.get(key) || [];
    list.push(copy);
    byCourse.set(key, list);
  }

  const output: Section[] = [];
  // Sort course keys deterministically for order-independence
  const sortedCourseKeys = Array.from(byCourse.keys()).sort();

  for (const courseKey of sortedCourseKeys) {
    const rawGroup = byCourse.get(courseKey) || [];
    const formattedGroup = mergeDuplicateCanonicalSections(rawGroup, mergeSectionLosslessly);
    const group = consolidateDerivedCompositeSections(formattedGroup, mergeSectionLosslessly);
    const explicitSections = new Map<string, Section>();
    const missingSections: Section[] = [];

    for (const section of group) {
      section.courseKey = courseKey;
      const explicitKey = explicitSectionIdentity(section);
      if (!explicitKey || section.sectionCodeMissing) {
        section.sectionCode = section.sectionCode?.trim() || null;
        section.sectionCodeMissing = true;
        section.needsReview = true;
        section.reviewReasons = Array.from(new Set([...(section.reviewReasons || []), 'section_code_missing']));
        missingSections.push(section);
        continue;
      }

      const existing = explicitSections.get(explicitKey);
      if (!existing) explicitSections.set(explicitKey, section);
      else mergeSectionLosslessly(existing, section);
    }

    const reconciledExplicit = Array.from(explicitSections.values());
    const unresolvedMissing: Section[] = [];

    for (const missing of missingSections) {
      const scoredMatches = reconciledExplicit
        .map((candidate) => ({ candidate, score: scoreMissingSectionAssociation(missing, candidate) }))
        .filter((entry) => entry.score >= 5)
        .sort((a, b) => b.score - a.score);

      let matches: Section[] = [];
      if (scoredMatches.length > 0) {
        const best = scoredMatches[0];
        const second = scoredMatches[1];
        if (!second || best.score - second.score >= 2) matches = [best.candidate];
      }

      if (matches.length === 0 && reconciledExplicit.length === 1) {
        const onlyCandidate = reconciledExplicit[0];
        const sameCredits = missing.credits != null && onlyCandidate.credits != null && Number(missing.credits) === Number(onlyCandidate.credits);
        const candidateHasNoMeetings = (onlyCandidate.sessions || []).length === 0;
        const missingHasEvidence = (missing.sessions || []).length > 0 || Boolean(missing.incompleteMeetings?.length);
        if (candidateHasNoMeetings && sameCredits && missingHasEvidence) {
          matches = [onlyCandidate];
          matches[0].needsReview = true;
          matches[0].reviewReasons = Array.from(new Set([...(matches[0].reviewReasons || []), 'section_association_inferred']));
        }
      }

      if (matches.length === 1) {
        mergeSectionLosslessly(matches[0], missing);
        matches[0].sectionCodeMissing = false;
        if (matches[0].sectionCode) {
          matches[0].reviewReasons = (matches[0].reviewReasons || []).filter((reason) => reason !== 'section_code_missing');
        }
      } else {
        unresolvedMissing.push(missing);
      }
    }

    reconcileCreditConflictsAcrossCourse(reconciledExplicit);
    output.push(...reconciledExplicit);

    const uniqueMissing = new Map<string, Section>();
    for (const missing of unresolvedMissing) {
      const fingerprint = missingSectionFingerprint(missing);
      const existing = uniqueMissing.get(fingerprint);
      if (existing) mergeSectionLosslessly(existing, missing);
      else uniqueMissing.set(fingerprint, missing);
    }
    output.push(...uniqueMissing.values());
  }

  // Sort sections and sessions deterministically for order-independence
  for (const s of output) {
    s.courseKey = buildCourseKey(s.courseCode, s.name);
    if (!s.sourceEvidence) s.sourceEvidence = { sourceImageIndexes: s.sourceImageIndexes || [], ocrRunId: s.ocrRunId, raw: Array.isArray(s.rawOcrEvidence) ? s.rawOcrEvidence.slice(0, 20) : undefined };
    if (!s.canonicalSectionKey && (s.rawSectionCode || s.sectionCode)) {
      s.canonicalSectionKey = canonicalizeSectionIdentity(s.rawSectionCode || s.sectionCode);
    }
    if (Array.isArray(s.sessions)) {
      s.sessions.sort((a, b) => {
        const dDiff = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
        if (dDiff !== 0) return dDiff;
        return a.start.localeCompare(b.start) || a.end.localeCompare(b.end);
      });
    }
  }

  // Deterministic section ordering across courses
  output.sort((a, b) => {
    const cDiff = (a.courseKey || '').localeCompare(b.courseKey || '');
    if (cDiff !== 0) return cDiff;
    const aKey = a.canonicalSectionKey || a.sectionCode || (a.sessions || []).map(meetingKey).sort().join('|');
    const bKey = b.canonicalSectionKey || b.sectionCode || (b.sessions || []).map(meetingKey).sort().join('|');
    return aKey.localeCompare(bKey);
  });

  return output;
}

export function validateOCRSections(sections: Section[]): { valid: boolean; score: number; reasons: string[] } {
  if (!Array.isArray(sections) || sections.length === 0) return { valid: false, score: 0, reasons: ['no_courses'] };

  let score = 0;
  const reasons: string[] = [];
  let hasIdentity = false;
  let invalidNormalizedSession = false;

  for (const section of sections) {
    if (section.courseCode) { score += 5; hasIdentity = true; }
    if (section.name) { score += 3; hasIdentity = true; }
    if (section.sectionCode) score += 1;
    if (section.credits !== null && section.credits !== undefined) score += 1;

    for (const session of section.sessions || []) {
      if (!DAY_ORDER.includes(session.day)) { reasons.push('invalid_day'); invalidNormalizedSession = true; continue; }
      if (!/^\d{2}:\d{2}$/.test(session.start) || !/^\d{2}:\d{2}$/.test(session.end)) {
        reasons.push('invalid_normalized_time');
        invalidNormalizedSession = true;
        continue;
      }
      if (timeMinutes(session.start) >= timeMinutes(session.end)) {
        reasons.push('invalid_time_order');
        invalidNormalizedSession = true;
      }
      score += 3;
    }

    if (section.incompleteMeetings?.length) reasons.push('incomplete_meeting');
    if (section.conflictingMeetings?.length) reasons.push('conflicting_meeting');
    if (section.creditHoursConflict?.length) reasons.push('credit_conflict');
    if (section.needsReview) score -= 0.5;
  }

  if (!hasIdentity) reasons.push('no_course_identity');
  if (invalidNormalizedSession) return { valid: false, score, reasons: Array.from(new Set(reasons)) };
  return { valid: hasIdentity, score, reasons: Array.from(new Set(reasons)) };
}

export {
  canonicalizeDisplaySectionCode,
  canonicalizeSectionIdentity,
  classifySectionCodeRelation,
  getCanonicalSectionKey,
  getResolvedSectionIdentity,
  mergeDuplicateCanonicalSections,
  parseCourseCodeStructure,
};

