import { DayOfWeek, Section, SessionType } from '../../types';
import { getCourseIdentityKey } from '../../utils/courseUtils';
import { timeToMinutes } from '../../utils/optimizer';
import { safeStorage, parseStorageEnvelope } from '../../utils/safeStorage';
import { normalizeMeetingType } from '../../utils/meetingTypes';

export interface UploadedFileItem {
  id: string;
  file?: File;
  preview: string;
  name: string;
  contentHash?: string | null;
  visualFingerprint?: string | null;
  status: 'idle' | 'processing' | 'success' | 'corpus-ready' | 'failed';
  errorMessage?: string;
  errorReasonCode?: string;
  retryable?: boolean;
  retryAfter?: number;
  extractedSectionsCount?: number;
}

export interface ManualSessionRow {
  id: string;
  day: DayOfWeek | '';
  start: string;
  rawStart?: string;
  end: string;
  rawEnd?: string;
  type: SessionType;
  customType?: string;
}

export interface ManualFormState {
  id: string;
  name: string;
  courseCode: string;
  sectionCode: string;
  credits: string;
  instructor?: string;
  sessions: ManualSessionRow[];
}

export const createLocalId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const createEmptySession = (idSuffix: string = '1', defaultType: SessionType = 'Lecture'): ManualSessionRow => ({
  id: createLocalId(`s-${idSuffix}`),
  day: '',
  start: '',
  rawStart: '',
  end: '',
  rawEnd: '',
  type: defaultType,
  customType: '',
});

export const createEmptyManualForm = (idSuffix: string = '1'): ManualFormState => ({
  id: createLocalId(`form-${idSuffix}`),
  name: '',
  courseCode: '',
  sectionCode: '',
  credits: '',
  sessions: [createEmptySession('1')],
});


export function sanitizeRecoveredSession(value: unknown): ManualSessionRow | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<ManualSessionRow>;
  const validDay = s.day === '' || ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'].includes(String(s.day));
  if (!validDay || typeof s.id !== 'string' || !s.id.trim() || typeof s.start !== 'string' || typeof s.end !== 'string' || typeof s.type !== 'string') return null;
  return {
    id: s.id.trim(),
    day: (s.day || '') as DayOfWeek | '',
    start: s.start,
    rawStart: typeof s.rawStart === 'string' ? s.rawStart : s.start,
    end: s.end,
    rawEnd: typeof s.rawEnd === 'string' ? s.rawEnd : s.end,
    type: normalizeMeetingType(s.type),
    customType: typeof s.customType === 'string' ? s.customType : '',
  };
}

export function sanitizeRecoveredManualForm(value: unknown): ManualFormState | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Partial<ManualFormState>;
  if (
    typeof f.id !== 'string' || !f.id.trim() ||
    typeof f.name !== 'string' ||
    typeof f.sectionCode !== 'string' ||
    (f.courseCode !== undefined && typeof f.courseCode !== 'string') ||
    typeof f.credits !== 'string' ||
    !Array.isArray(f.sessions)
  ) return null;
  const sessions = f.sessions.flatMap((s) => {
    const sanitized = sanitizeRecoveredSession(s);
    return sanitized ? [sanitized] : [];
  });
  return {
    id: f.id.trim(),
    name: f.name,
    // Older saved forms did not have a separate courseCode. Preserve them safely
    // but require the user to fill the new field before saving.
    courseCode: typeof f.courseCode === 'string' ? f.courseCode : '',
    sectionCode: f.sectionCode,
    credits: f.credits,
    instructor: typeof f.instructor === 'string' ? f.instructor : '',
    sessions: sessions.length > 0 ? sessions : [createEmptySession('recovered')],
  };
}

export function sanitizeRecoveredSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((valueItem) => {
    if (!valueItem || typeof valueItem !== 'object') return [];
    const item = valueItem as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.sessions)) return [];
    const sessions = item.sessions.flatMap((sessionValue) => {
      if (!sessionValue || typeof sessionValue !== 'object') return [];
      const session = sessionValue as Record<string, unknown>;
      const day = session.day;
      const start = session.start;
      const end = session.end;
      if (!['SAT','SUN','MON','TUE','WED','THU','FRI'].includes(String(day)) || typeof start !== 'string' || typeof end !== 'string' || !Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end)) || timeToMinutes(start) >= timeToMinutes(end)) return [];
      return [{
        id: typeof session.id === 'string' ? session.id.trim() : undefined,
        day: day as Section['sessions'][number]['day'], start, end,
        type: normalizeMeetingType(session.type),
        customType: typeof session.customType === 'string' ? session.customType.slice(0, 200) : undefined,
        rawType: typeof session.rawType === 'string' ? session.rawType.slice(0, 200) : undefined,
        rawStart: typeof session.rawStart === 'string' ? session.rawStart.slice(0, 100) : undefined,
        rawEnd: typeof session.rawEnd === 'string' ? session.rawEnd.slice(0, 100) : undefined,
        ambiguousTime: session.ambiguousTime === true,
        sourceEvidence: session.sourceEvidence && typeof session.sourceEvidence === 'object' ? {
          sourceImageIndexes: Array.isArray((session.sourceEvidence as Record<string, unknown>).sourceImageIndexes) ? ((session.sourceEvidence as Record<string, unknown>).sourceImageIndexes as unknown[]).filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 30) : undefined,
          sourceRecordIndex: Number.isInteger((session.sourceEvidence as Record<string, unknown>).sourceRecordIndex) ? Number((session.sourceEvidence as Record<string, unknown>).sourceRecordIndex) : undefined,
          confidence: Number.isFinite(Number((session.sourceEvidence as Record<string, unknown>).confidence)) ? Number((session.sourceEvidence as Record<string, unknown>).confidence) : undefined,
          ocrRunId: typeof (session.sourceEvidence as Record<string, unknown>).ocrRunId === 'string' ? String((session.sourceEvidence as Record<string, unknown>).ocrRunId).slice(0, 100) : undefined,
          aliasOfSection: typeof (session.sourceEvidence as Record<string, unknown>).aliasOfSection === 'string' ? String((session.sourceEvidence as Record<string, unknown>).aliasOfSection).slice(0, 100) : undefined,
        } : undefined,
      }];
    });
    if (!item.id.trim() || !item.name.trim() || sessions.length === 0) return [];
    const credits = item.credits == null || item.credits === '' ? null : Number(item.credits);
    return [{
      id: item.id.trim(), name: item.name.trim(),
      courseCode: typeof item.courseCode === 'string' ? item.courseCode.trim() : null,
      sectionCode: typeof item.sectionCode === 'string' ? item.sectionCode.trim() : null,
      rawSectionCode: typeof item.rawSectionCode === 'string' ? item.rawSectionCode.trim() : null,
      courseKey: getCourseIdentityKey(typeof item.courseCode === 'string' ? item.courseCode : null, item.name),
      canonicalSectionKey: typeof item.canonicalSectionKey === 'string' ? item.canonicalSectionKey.trim() : null,
      sectionCodeMissing: item.sectionCodeMissing === true, needsReview: item.needsReview === true,
      reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons.filter((v): v is string => typeof v === 'string').slice(0, 30) : [],
      credits: Number.isFinite(credits) ? credits : null, sessions,
      instructor: typeof item.instructor === 'string' ? item.instructor.slice(0, 200) : null,
      sourceImageIndexes: Array.isArray(item.sourceImageIndexes) ? item.sourceImageIndexes.filter((v): v is number => Number.isInteger(v) && v >= 0).slice(0, 30) : [],
      ocrRunId: typeof item.ocrRunId === 'string' ? item.ocrRunId.slice(0, 100) : undefined,
      workflowGenerationId: typeof item.workflowGenerationId === 'string' ? item.workflowGenerationId.slice(0, 100) : undefined,
      sourceKind: item.sourceKind === 'manual' || item.sourceKind === 'recovered' ? item.sourceKind : 'recovered',
      originalOcrCourseCode: typeof item.originalOcrCourseCode === 'string' ? item.originalOcrCourseCode.slice(0,100) : null,
      originalOcrCourseName: typeof item.originalOcrCourseName === 'string' ? item.originalOcrCourseName.slice(0,300) : null,
      editedFields: Array.isArray(item.editedFields) ? item.editedFields.filter((v): v is string => typeof v === 'string').slice(0,30) : [],
      userOverrides: item.userOverrides && typeof item.userOverrides === 'object' && !Array.isArray(item.userOverrides) ? Object.fromEntries(Object.entries(item.userOverrides as Record<string, unknown>).filter(([,v]) => ['string','number','boolean'].includes(typeof v) || v === null).slice(0,30)) as Section['userOverrides'] : undefined,
      sourceEvidence: item.sourceEvidence && typeof item.sourceEvidence === 'object' ? { sourceImageIndexes: Array.isArray((item.sourceEvidence as any).sourceImageIndexes) ? (item.sourceEvidence as any).sourceImageIndexes.filter((v: unknown): v is number => Number.isInteger(v) && v >= 0).slice(0,30) : [], ocrRunId: typeof (item.sourceEvidence as any).ocrRunId === 'string' ? String((item.sourceEvidence as any).ocrRunId).slice(0,100) : undefined } : undefined,
    } as Section];
  });
}

export function sanitizePendingReviewSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return [];
  const sanitizeEvidence = (input: unknown, depth = 0): unknown => {
    if (depth > 3) return undefined;
    if (input === null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'string') return input.slice(0, 1200);
    if (Array.isArray(input)) return input.slice(0, 40).map((item) => sanitizeEvidence(item, depth + 1)).filter((item) => item !== undefined);
    if (!input || typeof input !== 'object') return undefined;
    const allowed = new Set([
      'sourceChunkIndex','sourceImageIndexes','corpusImageIndexes','sourceImageIndex','model','sourceRecordIndex','ocrRunId',
      'day','days','start','end','start_time','end_time','time','raw_time','type','meeting_type','ambiguousTime','ambiguous_time',
      'confidence','evidence','course_name','course_title','course_code','courseCode','section_code','section_id','section_number',
      'credits','credit_hours','credit_hours_conflict','instructor','tutorial_code','part_time','reason','section_code_missing','needs_review','review_reasons'
    ]);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      const safe = sanitizeEvidence(child, depth + 1);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  };

  return value.flatMap((valueItem) => {
    if (!valueItem || typeof valueItem !== 'object') return [];
    const item = valueItem as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    const rawSessions = Array.isArray(item.sessions) ? item.sessions : [];
    const sessions = rawSessions.flatMap((sessionValue) => {
      if (!sessionValue || typeof sessionValue !== 'object') return [];
      const session = sessionValue as Record<string, unknown>;
      const day = session.day, start = session.start, end = session.end;
      if (!['SAT','SUN','MON','TUE','WED','THU','FRI'].includes(String(day)) || typeof start !== 'string' || typeof end !== 'string' || !Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end)) || timeToMinutes(start) >= timeToMinutes(end)) return [];
      return [session as unknown as Section['sessions'][number]];
    });
    const incompleteMeetings = Array.isArray(item.incompleteMeetings) ? item.incompleteMeetings.slice(0, 40).map((meetingValue) => {
      if (!meetingValue || typeof meetingValue !== 'object') return null;
      const meeting = meetingValue as Record<string, unknown>;
      const sourceValue = meeting.source;
      const source = sourceValue && typeof sourceValue === 'object' ? sourceValue as Record<string, unknown> : null;
      return {
        raw: sanitizeEvidence(meeting.raw),
        reasonCodes: Array.isArray(meeting.reasonCodes) ? meeting.reasonCodes.filter((r): r is string => typeof r === 'string').slice(0, 20) : [],
        source: source ? {
          sourceChunkIndex: Number.isInteger(source.sourceChunkIndex) ? Number(source.sourceChunkIndex) : undefined,
          sourceImageIndexes: Array.isArray(source.sourceImageIndexes) ? source.sourceImageIndexes.filter((n): n is number => Number.isInteger(n)).slice(0, 30) : undefined,
          sourceImageIndex: Number.isInteger(source.sourceImageIndex) ? Number(source.sourceImageIndex) : undefined,
          model: typeof source.model === 'string' ? source.model.slice(0, 120) : undefined,
          sourceRecordIndex: Number.isInteger(source.sourceRecordIndex) ? Number(source.sourceRecordIndex) : undefined,
          ocrRunId: typeof source.ocrRunId === 'string' ? source.ocrRunId.slice(0, 100) : undefined,
        } : undefined,
      };
    }).filter((meeting): meeting is NonNullable<typeof meeting> => meeting !== null) : [];
    const credits = item.credits == null || item.credits === '' ? null : Number(item.credits);
    return [{
      id: item.id.trim(), name: item.name.trim(),
      courseCode: typeof item.courseCode === 'string' ? item.courseCode.trim() : null,
      sectionCode: typeof item.sectionCode === 'string' ? item.sectionCode.trim() : null,
      rawSectionCode: typeof item.rawSectionCode === 'string' ? item.rawSectionCode.trim() : null,
      courseKey: getCourseIdentityKey(typeof item.courseCode === 'string' ? item.courseCode : null, item.name),
      credits: Number.isFinite(credits) ? credits : null,
      sessions,
      incompleteMeetings,
      conflictingMeetings: Array.isArray(item.conflictingMeetings) ? item.conflictingMeetings.slice(0, 40).map((v) => sanitizeEvidence(v)).filter((v) => v !== undefined) : [],
      rawOcrEvidence: Array.isArray(item.rawOcrEvidence) ? item.rawOcrEvidence.slice(0, 80).map((v) => sanitizeEvidence(v)).filter((v) => v !== undefined) : [],
      reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons.filter((r): r is string => typeof r === 'string').slice(0, 30) : [],
      sourceImageIndexes: Array.isArray(item.sourceImageIndexes) ? item.sourceImageIndexes.filter((n): n is number => Number.isInteger(n)).slice(0, 30) : [],
      ocrRunId: typeof item.ocrRunId === 'string' ? item.ocrRunId.slice(0, 100) : undefined,
      reviewAcknowledged: item.reviewAcknowledged === true,
      sourceKind: item.sourceKind === 'manual' || item.sourceKind === 'recovered' ? item.sourceKind : 'ocr',
      editedFields: Array.isArray(item.editedFields) ? item.editedFields.filter((r): r is string => typeof r === 'string').slice(0,30) : [],
      userOverrides: item.userOverrides && typeof item.userOverrides === 'object' && !Array.isArray(item.userOverrides) ? Object.fromEntries(Object.entries(item.userOverrides as Record<string, unknown>).filter(([,v]) => ['string','number','boolean'].includes(typeof v) || v === null).slice(0,30)) as Section['userOverrides'] : undefined,
      sourceEvidence: { sourceImageIndexes: Array.isArray(item.sourceImageIndexes) ? item.sourceImageIndexes.filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0,30) : [], ocrRunId: typeof item.ocrRunId === 'string' ? item.ocrRunId.slice(0,100) : undefined },
    } as Section];
  }).filter((section) => Boolean(section.id && section.name));
}

export function readLatestPersisted<T>(key: string, sanitize: (value: unknown) => T | null, expectedSchemaVersion?: string): T | null {
  const candidates = [
    { raw: safeStorage.getItem(key), source: 'local' as const },
    { raw: safeStorage.sessionGetItem(key), source: 'session' as const },
  ]
    .map(({ raw, source }) => {
      const env = parseStorageEnvelope<T>(raw);
      if (env) {
        if (expectedSchemaVersion && env.schemaVersion !== expectedSchemaVersion) return null;
        const data = sanitize(env.data);
        return data === null ? null : { data, updatedAt: env.updatedAt, source };
      }
      if (!raw) return null;
      try {
        const data = sanitize(JSON.parse(raw));
        return data === null ? null : { data, updatedAt: 0, source };
      } catch { return null; }
    })
    .filter(Boolean) as Array<{ data: T; updatedAt: number; source: 'local' | 'session' }>;
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0].data;
}
