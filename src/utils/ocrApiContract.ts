/** Deterministic, provider-agnostic helpers for the Gemini OCR call contract. */


function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getStringField(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  return typeof record?.[key] === 'string' ? String(record[key]) : undefined;
}

function getNumberField(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  return typeof record?.[key] === 'number' && Number.isFinite(record[key]) ? Number(record[key]) : undefined;
}

export class OcrTimeoutError extends Error {
  isTimeout = true;
  constructor(message: string) {
    super(message);
    this.name = 'OcrTimeoutError';
  }
}

export interface OcrRetryOptions {
  timeoutMs: number;
  parentSignal?: AbortSignal;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function isOcrRateLimitError(err: unknown): boolean {
  const message = (getStringField(err, 'message') ?? (typeof err === 'string' ? err : '')).toLowerCase();
  const record = asRecord(err);
  const nested = asRecord(record?.error);
  const status = Number(record?.status ?? record?.statusCode ?? nested?.code ?? NaN);
  return status === 429 || message.includes('429') || message.includes('quota') || message.includes('rate limit') || message.includes('resource_exhausted');
}

export function extractRetryDelayMs(err: unknown, minMs = 500, maxMs = 8000): number | null {
  try {
    const record = asRecord(err);
    const nested = asRecord(record?.error);
    const details = Array.isArray(nested?.details) ? nested.details : [];
    const detailRetryDelay = details.map((detail) => getStringField(detail, 'retryDelay')).find(Boolean);
    const candidates: unknown[] = [record?.retryDelay, record?.retry_after, nested?.retryDelay, detailRetryDelay];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        return Math.min(maxMs, Math.max(minMs, Math.round(candidate)));
      }
      if (typeof candidate === 'string') {
        const seconds = candidate.match(/^(\d+(?:\.\d+)?)s$/i);
        if (seconds) {
          const ms = Math.round(Number(seconds[1]) * 1000);
          if (ms > 0) return Math.min(maxMs, Math.max(minMs, ms));
        }
      }
    }
  } catch {
    // Malformed provider metadata must never break the fallback path.
  }
  return null;
}

export async function generateWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let parentListener: (() => void) | null = null;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason || new Error('Operation aborted by client'));
    } else {
      parentListener = () => controller.abort(parentSignal.reason || new Error('Operation aborted by client'));
      parentSignal.addEventListener('abort', parentListener, { once: true });
    }
  }

  let timeoutReject: ((reason?: unknown) => void) | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutReject = reject;
  });
  const timeoutId = setTimeout(() => {
    const timeoutError = new OcrTimeoutError(`Model request timed out after ${timeoutMs}ms`);
    controller.abort(timeoutError);
    timeoutReject?.(timeoutError);
  }, timeoutMs);

  let abortReject: ((reason?: unknown) => void) | null = null;
  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  if (parentSignal) {
    if (parentSignal.aborted) abortReject?.(new Error('CLIENT_ABORTED'));
    else {
      abortListener = () => abortReject?.(new Error('CLIENT_ABORTED'));
      parentSignal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    // Race the provider call against timeout/abort, so safety does not depend on the
    // SDK honoring AbortSignal. The provider promise remains observed by Promise.race
    // and cannot create an unhandled rejection after the race settles.
    return await Promise.race([fn(controller.signal), timeoutPromise, abortPromise]);
  } catch (err) {
    if (parentSignal?.aborted || (err instanceof Error && err.message === 'CLIENT_ABORTED')) {
      throw new Error('CLIENT_ABORTED');
    }
    if (controller.signal.aborted) throw new OcrTimeoutError(`Model request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (parentSignal && parentListener) parentSignal.removeEventListener('abort', parentListener);
    if (parentSignal && abortListener) parentSignal.removeEventListener('abort', abortListener);
  }
}

/**
 * Runs one Gemini model call and retries only transient rate-limit failures.
 * The caller owns model fallback; this helper guarantees each individual model gets
 * a bounded retry budget and that timeout/client-abort signals are propagated.
 */
export function getOcrErrorStatus(err: unknown): number | null {
  const record = asRecord(err);
  const nested = asRecord(record?.error);
  const raw = record?.status ?? record?.statusCode ?? nested?.code;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

export function isRetryableOcrError(err: unknown): boolean {
  if (isOcrRateLimitError(err)) return true;
  const status = getOcrErrorStatus(err);
  if (status !== null && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  const message = (getStringField(err, 'message') ?? (typeof err === 'string' ? err : '')).toLowerCase();
  return /timeout|timed out|econnreset|econnrefused|enotfound|socket hang up|network|temporar|unavailable|bad gateway|gateway timeout/.test(message);
}

export async function callOcrModelWithRetry<T>(
  generate: (signal: AbortSignal) => Promise<T>,
  options: OcrRetryOptions,
): Promise<T> {
  const timeoutMs = Math.max(250, Math.min(120_000, Math.floor(options.timeoutMs)));
  const attempts = Math.max(1, Math.min(3, Math.floor(options.attempts ?? 2)));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await generateWithTimeout(generate, timeoutMs, options.parentSignal);
    } catch (err) {
      lastError = err;
      if (options.parentSignal?.aborted || getStringField(err, 'message') === 'CLIENT_ABORTED') {
        throw new Error('CLIENT_ABORTED');
      }
      if (!isRetryableOcrError(err) || attempt >= attempts - 1) throw err;

      const base = extractRetryDelayMs(err) ?? (isOcrRateLimitError(err) ? 1500 : 700);
      const jitter = Math.max(0.75, Math.min(1.25, 0.75 + random() * 0.5));
      const retryDelayMs = Math.min(4000, Math.max(250, Math.round(base * jitter)));
      if (options.parentSignal?.aborted) throw new Error('CLIENT_ABORTED');
      if (options.sleep) {
        await sleep(retryDelayMs);
      } else {
        await new Promise<void>((resolve, reject) => {
          if (options.parentSignal?.aborted) { reject(new Error('CLIENT_ABORTED')); return; }
          const timer = setTimeout(() => { cleanup(); resolve(); }, retryDelayMs);
          const onAbort = () => { cleanup(); reject(new Error('CLIENT_ABORTED')); };
          const cleanup = () => { clearTimeout(timer); options.parentSignal?.removeEventListener('abort', onAbort); };
          options.parentSignal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (options.parentSignal?.aborted) throw new Error('CLIENT_ABORTED');
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Parse provider text without unbounded scanning or repeated JSON.parse work. */
export function parseOcrJsonPayload(responseText: unknown): Record<string, unknown> | null {
  const MAX_SCAN_CHARS = 2_000_000;
  const raw = String(responseText ?? '').trim();
  if (!raw || raw.length > MAX_SCAN_CHARS) return null;
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object') return null;
      if (Array.isArray(parsed)) {
        const isCourseList = parsed.some((item) => item && typeof item === 'object' && ('course_code' in item || 'course_name' in item || 'sections' in item));
        return isCourseList ? { courses: parsed } : { sections: parsed };
      }
      const record = parsed as Record<string, unknown>;
      if (!Array.isArray(record.courses) && !Array.isArray(record.sections)) return null;
      return record;
    } catch { return null; }
  };
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) { const parsed = tryParse(fence[1].trim()); if (parsed) return parsed; }
  let start = -1; let inString = false; let escaped = false; let depth = 0; const stack: string[] = [];
  const MAX_NESTING_DEPTH = 32;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { if (depth === 0) start = i; if (depth >= MAX_NESTING_DEPTH) { stack.length = 0; depth = 0; start = -1; continue; } stack.push(ch); depth++; continue; }
    if (ch === '}' || ch === ']') {
      const expected = ch === '}' ? '{' : '['; if (stack[stack.length - 1] !== expected) { depth = 0; stack.length = 0; start = -1; continue; }
      stack.pop(); depth--;
      if (depth === 0 && start >= 0) { const candidate = raw.slice(start, i + 1); const parsed = tryParse(candidate); if (parsed) return parsed; start = -1; }
    }
  }
  return null;
}

/**
 * Structural contract gate. This deliberately validates shape only; semantic
 * interpretation belongs to ocrExtractionCore so the two concerns stay separate.
 */
export function validateOcrModelShape(value: unknown): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, reasons: ['root_not_object'] };

  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.courses)) return { valid: false, reasons: ['courses_array_missing'] };

  const isNullableString = (v: unknown) => v === null || typeof v === 'string';
  const isNullableNumber = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  const isBoolean = (v: unknown) => typeof v === 'boolean';
  const isStringArray = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  const checkMeeting = (meeting: unknown, path: string) => {
    if (!meeting || typeof meeting !== 'object' || Array.isArray(meeting)) {
      reasons.push(`${path}_not_object`);
      return;
    }
    const m = meeting as Record<string, unknown>;
    for (const key of ['day', 'type', 'start_time', 'end_time', 'raw_time']) {
      if (key in m && !isNullableString(m[key])) reasons.push(`${path}_${key}_invalid`);
    }
    if ('ambiguous_time' in m && !isBoolean(m.ambiguous_time)) reasons.push(`${path}_ambiguous_time_invalid`);
    if ('confidence' in m && !(m.confidence === null || (typeof m.confidence === 'number' && Number.isFinite(m.confidence) && m.confidence >= 0 && m.confidence <= 1))) reasons.push(`${path}_confidence_invalid`);
    for (const key of ['source_image_index', 'source_record_index']) {
      if (key in m && m[key] !== undefined && m[key] !== null && (!Number.isInteger(m[key]) || (m[key] as number) < 0)) reasons.push(`${path}_${key}_invalid`);
    }
  };

  root.courses.forEach((course, index) => {
    const path = `course_${index}`;
    if (!course || typeof course !== 'object' || Array.isArray(course)) {
      reasons.push(`${path}_not_object`);
      return;
    }
    const c = course as Record<string, unknown>;
    for (const key of ['course_name', 'course_code']) {
      if (key in c && !isNullableString(c[key])) reasons.push(`${path}_${key}_invalid`);
    }
    if ('code_inferred' in c && !isBoolean(c.code_inferred)) reasons.push(`${path}_code_inferred_invalid`);
    if ('credit_hours' in c && !isNullableNumber(c.credit_hours)) reasons.push(`${path}_credit_hours_invalid`);
    if ('credit_hours_conflict' in c && c.credit_hours_conflict !== null && !(Array.isArray(c.credit_hours_conflict) && c.credit_hours_conflict.every((x) => typeof x === 'number' && Number.isFinite(x)))) reasons.push(`${path}_credit_hours_conflict_invalid`);
    if ('needs_review' in c && !isBoolean(c.needs_review)) reasons.push(`${path}_needs_review_invalid`);
    if (!isStringArray(c.review_reasons)) reasons.push(`${path}_review_reasons_invalid`);

    const sections = c.sections;
    if (!Array.isArray(sections)) {
      reasons.push(`${path}_sections_array_missing`);
      return;
    }
    sections.forEach((section, sectionIndex) => {
      const spath = `${path}_section_${sectionIndex}`;
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        reasons.push(`${spath}_not_object`);
        return;
      }
      const s = section as Record<string, unknown>;
      for (const key of ['section_code', 'tutorial_code', 'instructor']) {
        if (key in s && !isNullableString(s[key])) reasons.push(`${spath}_${key}_invalid`);
      }
      if ('source_image_index' in s && s.source_image_index !== undefined && s.source_image_index !== null && (!Number.isInteger(s.source_image_index) || (s.source_image_index as number) < 0)) reasons.push(`${spath}_source_image_index_invalid`);
      if ('source_record_index' in s && s.source_record_index !== undefined && s.source_record_index !== null && (!Number.isInteger(s.source_record_index) || (s.source_record_index as number) < 0)) reasons.push(`${spath}_source_record_index_invalid`);
      if ('confidence' in s && !(s.confidence === null || (typeof s.confidence === 'number' && Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1))) reasons.push(`${spath}_confidence_invalid`);
      if ('part_time' in s && !(s.part_time === null || typeof s.part_time === 'string' || typeof s.part_time === 'boolean')) reasons.push(`${spath}_part_time_invalid`);
      if ('section_code_missing' in s && !isBoolean(s.section_code_missing)) reasons.push(`${spath}_section_code_missing_invalid`);
      if ('needs_review' in s && !isBoolean(s.needs_review)) reasons.push(`${spath}_needs_review_invalid`);
      if (!isStringArray(s.review_reasons)) reasons.push(`${spath}_review_reasons_invalid`);
      if (!Array.isArray(s.meetings)) reasons.push(`${spath}_meetings_array_missing`);
      else s.meetings.forEach((m, mi) => checkMeeting(m, `${spath}_meeting_${mi}`));
      if ('incomplete_meetings' in s) {
        if (!Array.isArray(s.incomplete_meetings)) reasons.push(`${spath}_incomplete_meetings_invalid`);
        else s.incomplete_meetings.forEach((m, mi) => checkMeeting(m, `${spath}_incomplete_meeting_${mi}`));
      }
      if ('conflicting_meetings' in s) {
        if (!Array.isArray(s.conflicting_meetings)) reasons.push(`${spath}_conflicting_meetings_invalid`);
        else s.conflicting_meetings.forEach((m, mi) => checkMeeting(m, `${spath}_conflict_${mi}`));
      }
    });
  });
  return { valid: reasons.length === 0, reasons };
}


import type { Section } from '../types';
import { getCourseIdentityKey } from './courseUtils';
import { timeToMinutes } from './optimizer';

export type OcrApiResponseStatus = 'success' | 'empty' | 'error';
export interface OcrApiResponse {
  success?: boolean;
  sections?: unknown;
  reasonCode?: string;
  message?: string;
  error?: string;
  retryAfter?: number;
  ocrRunId?: string;
  stats?: { ocrRunId?: string; totalImages?: number; totalCourses?: number; totalSections?: number };
}

const OCR_SUCCESS_CODES = new Set(['SUCCESS', 'NO_SCHEDULE_FOUND']);
export function validateOcrApiResponse(value: unknown): { valid: true; status: OcrApiResponseStatus; sections: Section[]; reasonCode: string; ocrRunId?: string } | { valid: false; reason: string } {
  if (!value || typeof value !== 'object') return { valid: false, reason: 'Response is not an object.' };
  const data = value as OcrApiResponse;
  const reasonCode = typeof data.reasonCode === 'string' ? data.reasonCode : '';
  if (data.success !== true || !OCR_SUCCESS_CODES.has(reasonCode)) return { valid: false, reason: 'Response does not match the success/empty OCR contract.' };
  if (!Array.isArray(data.sections)) return { valid: false, reason: 'sections must be an array.' };
  const sections: Section[] = [];
  for (const raw of data.sections) {
    if (!raw || typeof raw !== 'object') return { valid: false, reason: 'A returned section is malformed.' };
    const section = raw as Record<string, unknown>;
    if (typeof section.id !== 'string' || typeof section.name !== 'string' || !Array.isArray(section.sessions)) return { valid: false, reason: 'A returned section is malformed.' };
    const normalizedSessions = section.sessions.map((session) => {
      if (!session || typeof session !== 'object') return null;
      const normalized = session as Record<string, unknown>;
      return { ...normalized, day: normalized.day, start: normalized.start, end: normalized.end, type: normalized.type, customType: normalized.customType };
    }).filter((session): session is Record<string, unknown> => session !== null);
    for (const session of normalizedSessions) {
      if (!['SAT','SUN','MON','TUE','WED','THU','FRI'].includes(session.day)) return { valid: false, reason: 'A returned session contains an invalid day.' };
      const start = timeToMinutes(session.start); const end = timeToMinutes(session.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { valid: false, reason: 'A returned session contains an invalid time range.' };
    }
    const credits = section.credits == null ? null : Number(section.credits);
    if (credits !== null && (!Number.isFinite(credits) || credits < 0 || credits > 17)) return { valid: false, reason: 'A returned section contains invalid credits.' };
    sections.push({ ...section, courseKey: getCourseIdentityKey(typeof section.courseCode === 'string' ? section.courseCode : null, section.name), credits, sessions: normalizedSessions } as Section);
  }
  return { valid: true, status: reasonCode === 'NO_SCHEDULE_FOUND' ? 'empty' : 'success', sections, reasonCode, ocrRunId: typeof data.ocrRunId === 'string' ? data.ocrRunId : (typeof data.stats?.ocrRunId === 'string' ? data.stats.ocrRunId : undefined) };
}


export type OcrOutcome =
  | { kind: 'success'; sections: Section[]; reasonCode: 'SUCCESS'; ocrRunId?: string }
  | { kind: 'empty'; sections: []; reasonCode: 'NO_SCHEDULE_FOUND'; ocrRunId?: string }
  | { kind: 'error'; reasonCode: string; retryable: boolean; retryAfter?: number; errorId?: string };

export interface ApiErrorEnvelope {
  error: string;
  reasonCode: string;
  retryable?: boolean;
  retryAfter?: number;
  errorId?: string;
}
export function parseApiErrorEnvelope(value: unknown): ApiErrorEnvelope {
  const v = asRecord(value) || {};
  return {
    error: typeof v.error === 'string' ? v.error : 'The request could not be completed.',
    reasonCode: typeof v.reasonCode === 'string' ? v.reasonCode : 'API_ERROR',
    ...(typeof v.retryable === 'boolean' ? { retryable: v.retryable } : {}),
    ...(typeof v.retryAfter === 'number' && Number.isFinite(v.retryAfter) ? { retryAfter: v.retryAfter } : {}),
    ...(typeof v.errorId === 'string' ? { errorId: v.errorId } : {}),
  };
}

export interface OcrImageRequest { data: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; }
export interface OcrRequest { images: OcrImageRequest[]; workflowGenerationId: string; }
export function buildOcrRequest(images: OcrImageRequest[], workflowGenerationId: string): OcrRequest {
  if (!Array.isArray(images) || images.length === 0 || images.length > 40) throw new Error('Invalid OCR request image count.');
  return { images: images.map((image) => ({ data: String(image.data), mimeType: image.mimeType })), workflowGenerationId: String(workflowGenerationId).slice(0, 160) };
}

export interface OcrApiErrorInit { status?: number; reasonCode: string; retryable: boolean; retryAfter?: number; errorId?: string; }
export class OcrApiError extends Error {
  readonly status?: number; readonly reasonCode: string; readonly retryable: boolean; readonly retryAfter?: number; readonly errorId?: string;
  constructor(message: string, init: OcrApiErrorInit) { super(message); this.name = 'OcrApiError'; this.status = init.status; this.reasonCode = init.reasonCode; this.retryable = init.retryable; this.retryAfter = init.retryAfter; this.errorId = init.errorId; }
}

export function getSafeOcrUserMessage(err: unknown, fallback = 'We could not read those screenshots. Check the images and try again.'): string {
  const record = asRecord(err);
  const reason = typeof record?.reasonCode === 'string' ? record.reasonCode : '';
  const messages: Record<string, string> = {
    CLIENT_TIMEOUT: 'The screenshot-reading request took too long. Try again with the same screenshots.',
    OCR_CORPUS_TOO_LARGE: 'These screenshots are too large to read in one pass. Remove a few screenshots and try again.',
    INVALID_RESPONSE_CONTRACT: 'The screenshot-reading service returned an unsupported result. Please try again.',
    NO_SCHEDULE_FOUND: 'No readable course schedule details were found in these screenshots.',
    NETWORK_ERROR: 'The screenshot-reading service could not be reached. Check your connection and try again.',
  };
  return messages[reason] || fallback;
}
