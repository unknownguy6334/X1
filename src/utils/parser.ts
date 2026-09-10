import type { DayOfWeek, Section, Session, SessionType } from '../types';
import { resolveDayTokens, resolveSessionType } from './scheduleParsing';
import { isAmbiguousBareTime, normalizeTimeWithPolicy, parseTimeRangeWithPolicy } from './timeParsingPolicy';
import { parseCourseCode, normalizeCourseName, getCourseIdentityKey, deduplicateParsedBatch } from './courseUtils';

function normalizeDigits(raw: string): string {
  return String(raw || '')
    .replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x06F0));
}

function normalizeArabicTimeWords(raw: string): string {
  return normalizeDigits(raw)
    .replace(/(?:صباح(?:اً|ا)?|(?<=\d)\s*ص)(?![\u0600-\u06ff])/giu, ' AM ')
    .replace(/(?:مساء(?:ً|ا)?|(?<=\d)\s*م)(?![\u0600-\u06ff])/giu, ' PM ')
    .trim();
}

export function parseUserTypedTime(raw: string): string | null {
  if (!raw) return null;
  const clean = normalizeArabicTimeWords(raw).trim();
  if (!clean || /[-–—~]|\bto\b/i.test(clean)) return null;
  return normalizeTimeWithPolicy(clean);
}

export function normalizeTime(raw: string, isPMContext = false): string | null {
  return normalizeTimeWithPolicy(normalizeArabicTimeWords(raw), isPMContext);
}

export function formatTo12Hour(timeStr: string): string {
  if (!timeStr) return '';
  const clean = timeStr.trim();
  if (/(?:am|pm|a\.m\.|p\.m\.)/i.test(clean)) return clean;
  const parts = clean.split(':');
  if (parts.length < 2) return timeStr;
  let hours = Number(parts[0]);
  const mins = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(mins).padStart(2, '0')} ${ampm}`;
}

export function parseTimeRange(rangeStr: string): { start: string; end: string } | null {
  const parsed = parseTimeRangeWithPolicy(normalizeArabicTimeWords(rangeStr));
  if (!parsed) return null;
  const start = normalizeTime(parsed.rawStart, parsed.startPmContext);
  const end = normalizeTime(parsed.rawEnd, parsed.endPmContext);
  if (!start || !end) return null;
  const toMin = (v: string) => { const [h,m] = v.split(':').map(Number); return h * 60 + m; };
  if (toMin(start) >= toMin(end)) return null;
  return { start, end };
}

export function parseDays(dayString: string): DayOfWeek[] {
  return resolveDayTokens(normalizeDigits(dayString || ''));
}

function sessionId(day: DayOfWeek, start: string, end: string, type: SessionType): string {
  return `session:${day}:${start}:${end}:${String(type).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
}

/**
 * Extracts all meetings represented by a text fragment. Unknown meeting type is
 * represented as Other; there is no Lecture fallback because that would invent data.
 */
export function extractSessionsFromSegment(text: string): Session[] {
  if (!text) return [];
  const normalized = normalizeArabicTimeWords(text);
  const results: Session[] = [];
  const rangePattern = /(\d{1,4}(?::|\.)?\d{0,2}\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*(?:[-–—~]|\bto\b)\s*(\d{1,4}(?::|\.)?\d{0,2}\s*(?:am|pm|a\.m\.|p\.m\.)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(normalized)) !== null) {
    const whole = match[0];
    const range = parseTimeRange(whole);
    if (!range) continue;

    const before = normalized.slice(0, match.index);
    const localStart = Math.max(0, before.lastIndexOf('\n') + 1);
    const context = before.slice(localStart);
    const days = parseDays(context).length ? parseDays(context) : parseDays(normalized);
    if (!days.length) continue;

    const typeText = context;
    const type = resolveSessionType(
      /lab|laboratory|practical|معمل|مختبر|عملي|عملى/i.test(typeText) ? 'Lab' :
      /tutorial|tut\b|تدريب|تطبيق/i.test(typeText) ? 'Tutorial' :
      /discussion|disc\b|مناقش/i.test(typeText) ? 'Discussion' :
      /section|sec\b|سكشن|شعبة|تمارين/i.test(typeText) ? 'Section' :
      /lecture|lec\b|محاضرة|محاضره/i.test(typeText) ? 'Lecture' :
      /seminar/i.test(typeText) ? 'Seminar' :
      /workshop/i.test(typeText) ? 'Workshop' :
      /online|remote|distance|web|افتراضي|عن بعد|اونلاين|أونلاين|async/i.test(typeText) ? 'Online' :
      undefined,
    ) as SessionType;

    const ambiguous = isAmbiguousBareTime(match[1]) || isAmbiguousBareTime(match[2]);
    for (const day of days) {
      const candidate: Session = {
        id: sessionId(day, range.start, range.end, type),
        day,
        start: range.start,
        end: range.end,
        type,
        ...(ambiguous ? { ambiguousTime: true } : {}),
      };
      if (!results.some(s => s.day === candidate.day && s.start === candidate.start && s.end === candidate.end && s.type === candidate.type)) results.push(candidate);
    }
  }
  return results;
}

function looksLikeCredit(value: string): number | null {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:cr|credits?|credit\s*hours?|units?)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 17 ? n : null;
}

function looksLikeSectionCode(value: string): boolean {
  const v = value.trim();
  if (!v || parseCourseCode(v)) return false;
  return /^(?:section\s*)?(?:[A-Za-z]\d{1,4}|\d{1,4}|SEC(?:TION)?[-_ ]?[A-Za-z0-9]{1,8}|NEW\d{1,6})$/i.test(v);
}

function courseIdentityKey(name: string, code?: string | null): string {
  return getCourseIdentityKey(code, name);
}

function createTextSection(index: number, data: {
  name: string;
  code?: string | null;
  sectionCode?: string | null;
  credits?: number | null;
  instructor?: string | null;
  sessions: Session[];
}): Section {
  const code = data.code ?? null;
  const sectionCode = data.sectionCode?.trim() || null;
  const internalId = `text:${index + 1}:${sectionCode || 'missing'}`;
  return {
    id: internalId,
    name: data.name.trim(),
    courseKey: courseIdentityKey(data.name, code),
    courseCode: code,
    sectionCode,
    sectionCodeMissing: !sectionCode,
    needsReview: !sectionCode || data.sessions.some(s => s.type === 'Other' || s.ambiguousTime),
    reviewReasons: [
      ...(!sectionCode ? ['section_code_missing'] : []),
      ...(data.sessions.some(s => s.type === 'Other') ? ['meeting_type_missing_or_unrecognized'] : []),
      ...(data.sessions.some(s => s.ambiguousTime) ? ['ambiguous_time'] : []),
    ],
    credits: data.credits ?? null,
    instructor: data.instructor ?? null,
    sessions: data.sessions,
  };
}

/**
 * Parses pasted schedules without assuming field order. Headered TSV uses header
 * names; unheadered text is treated as evidence, not a fixed template.
 * Missing section identifiers remain missing and are never fabricated.
 */
export function parsePastedText(rawText: string): Section[] {
  if (!rawText || !rawText.trim()) return [];

  type Evidence = {
    lineIndex: number;
    raw: string;
    code: string | null;
    name: string | null;
    sectionCode: string | null;
    credits: number | null;
    instructor: string | null;
    sessions: Session[];
  };

  const lines = rawText.split(/\r?\n/).map((value, index) => ({
    lineIndex: index,
    raw: value.trim(),
  })).filter((entry) => entry.raw);

  const normalizeField = (value: string) => value.replace(/\s+/g, ' ').trim();
  const isDayOnly = (value: string) => {
    const parsed = parseDays(value);
    if (!parsed.length) return false;
    const stripped = value.toLowerCase().replace(/[\s,\\/+&-]/g, '');
    return /^[a-z]+$/i.test(stripped) && parsed.length >= 1 && parsed.length <= 7 && stripped.length <= 20;
  };
  const explicitCredit = (value: string): number | null => {
    const labelled = value.match(/(?:credits?|credit\s*hours?|cr|units?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
      || value.match(/(\d+(?:\.\d+)?)\s*(?:credits?|credit\s*hours?|cr|units?)/i);
    return labelled ? looksLikeCredit(labelled[1]) : null;
  };
  const extractInstructor = (value: string): string | null => {
    const match = value.match(/(?:instructor|prof(?:essor)?|lecturer|teacher)\s*[:\-]?\s*(.+)$/i);
    return match?.[1]?.trim() || null;
  };
  const extractSection = (value: string, code: string | null): string | null => {
    const labelled = value.match(/\b(?:section|sec)\s*[:#-]?\s*([A-Za-z]?\d{1,6})\b/i);
    if (labelled) return labelled[1];
    if (code && parseCourseCode(value) && normalizeField(value).toLowerCase() === normalizeField(code).toLowerCase()) return null;
    const codeNumber = code?.match(/(?:^|\s)(\d{1,6}[A-Za-z]?)$/)?.[1]?.toLowerCase() || null;
    for (const token of value.split(/[|,;()\[\]]|\s+-\s+|\s+/).map(normalizeField).filter(Boolean)) {
      if (codeNumber && token.toLowerCase() === codeNumber) continue;
      if (looksLikeSectionCode(token) && (!code || token.toLowerCase() !== code.toLowerCase())) return token;
    }
    return null;
  };
  const cleanNameCandidate = (value: string, code: string | null): string | null => {
    let candidate = normalizeField(value);
    if (!candidate) return null;
    candidate = candidate.replace(/^\s*(?:course|course name|course title|subject|title)\s*[:\-]\s*/i, '').trim();
    if (!candidate || (code && normalizeField(candidate).toLowerCase() === normalizeField(code).toLowerCase())) return null;
    if (parseCourseCode(candidate)) return null;
    if (looksLikeSectionCode(candidate)) return null;
    if (looksLikeCredit(candidate) !== null || explicitCredit(candidate) !== null) return null;
    if (isDayOnly(candidate)) return null;
    if (parseTimeRange(candidate) || /^(?:\d{1,4}(?::|\.)\d{1,2}|\d{3,4})\s*(?:am|pm|a\.m\.|p\.m\.)?$/i.test(candidate)) return null;
    if (/^(?:to|until|through|حتى|إلى|الى)$/i.test(candidate)) return null;
    if (extractSessionsFromSegment(candidate).length) return null;
    if (/^(?:instructor|prof(?:essor)?|lecturer|teacher|room|building|campus|location|modality|type|meeting\s*type)\b/i.test(candidate)) return null;
    return candidate;
  };

  const pipeCourseRows: Section[] = [];
  const pipeLineIndexes = new Set<number>();
  for (const line of lines) {
    if (!line.raw.includes('|')) continue;
    const cells = line.raw.split('|').map((cell) => cell.trim()).filter(Boolean);
    const codeCellIndexes = cells.map((cell, index) => ({ index, code: parseCourseCode(cell) })).filter((x): x is { index: number; code: string } => Boolean(x.code));
    if (codeCellIndexes.length < 2) continue;

    pipeLineIndexes.add(line.lineIndex);
    for (let i = 0; i < codeCellIndexes.length; i++) {
      const startCell = codeCellIndexes[i].index;
      const endCell = codeCellIndexes[i + 1]?.index ?? cells.length;
      const group = cells.slice(startCell, endCell);
      const code = codeCellIndexes[i].code;
      const sectionCode = group.map((cell) => extractSection(cell, code)).find(Boolean) || null;
      const name = group
        .map((cell) => cleanNameCandidate(cell, code))
        .find(Boolean) || '';
      const credits = group.map(explicitCredit).find((value): value is number => value !== null) ?? null;
      const sessions = extractSessionsFromSegment(group.filter((cell) => cell !== code && cell.toLowerCase() !== (name || '').toLowerCase()).join(' | '));
      pipeCourseRows.push(createTextSection(line.lineIndex + i / 100, {
        name,
        code,
        sectionCode,
        credits,
        instructor: group.map(extractInstructor).find(Boolean) || null,
        sessions,
      }));
    }
  }

  const evidences: Evidence[] = lines.filter(({ lineIndex }) => !pipeLineIndexes.has(lineIndex)).map(({ lineIndex, raw }) => {
    const sessions = extractSessionsFromSegment(raw);
    const credit = explicitCredit(raw);
    const instructor = extractInstructor(raw);
    const looksLikeMetadataLine = /^(?:instructor|prof(?:essor)?|lecturer|teacher|room|rm|building|bldg|campus|location|modality|type|meeting\s*type)\b/i.test(raw);
    const code = looksLikeMetadataLine ? null : parseCourseCode(raw);
    const sectionCode = extractSection(raw, code);
    let name: string | null = null;

    // Inline patterns are parsed before generic candidates so the parser is not
    // dependent on which field happens to appear first on a line.
    const paren = raw.match(/^(.+?)\s*\(([^)]+)\)/);
    if (paren) {
      const embeddedCode = parseCourseCode(paren[2]);
      if (embeddedCode) name = cleanNameCandidate(paren[1], embeddedCode);
    }
    if (!name && code) {
      const codeMatch = raw.match(new RegExp(`^(.+?)\\b${code.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&').replace(/\\s+/g, '\\s*')}\\b(.+)?$`, 'i'));
      if (codeMatch) {
        const before = cleanNameCandidate(codeMatch[1], code);
        const after = cleanNameCandidate(codeMatch[2] || '', code);
        name = before || after;
      }
    }
    if (!name && !sessions.length && !sectionCode && credit === null) name = cleanNameCandidate(raw, code);

    return { lineIndex, raw, code, name, sectionCode, credits: credit, instructor, sessions };
  });

  // Headered tables are deterministic because column headers define semantics.
  const tableHeaderIndex = evidences.findIndex((e) => e.raw.includes('\t') && e.raw.split('\t').some((c) => /course|subject|title|section|credit|unit|day|time|instructor|professor/i.test(c)));
  const result: Section[] = [...pipeCourseRows];
  const appendOrCreate = (candidate: Section) => {
    const candidateCourse = candidate.courseKey || getCourseIdentityKey(candidate.courseCode, candidate.name);
    candidate.courseKey = candidateCourse;
    const visibleSection = candidate.sectionCode?.trim().toLowerCase() || null;
    const equivalent = result.find((existing) => {
      const existingCourse = existing.courseKey || getCourseIdentityKey(existing.courseCode, existing.name);
      return existingCourse === candidateCourse && visibleSection && (existing.sectionCode?.trim().toLowerCase() || null) === visibleSection;
    });
    if (equivalent) {
      const exactMeetingKey = (session: Session) => `${session.day}|${session.start}|${session.end}|${session.type || 'Other'}`;
      for (const incoming of candidate.sessions || []) {
        if (equivalent.sessions.some((current) => exactMeetingKey(current) === exactMeetingKey(incoming))) continue;
        const conflictIndex = equivalent.sessions.findIndex((current) => current.day === incoming.day && (current.type || 'Other') === (incoming.type || 'Other'));
        if (conflictIndex >= 0) {
          const existing = equivalent.sessions.splice(conflictIndex, 1)[0];
          equivalent.conflictingMeetings = [
            ...(equivalent.conflictingMeetings || []),
            { day: existing.day, start_time: existing.start, end_time: existing.end, type: existing.type, reason: 'same_day_and_type_different_time' },
            { day: incoming.day, start_time: incoming.start, end_time: incoming.end, type: incoming.type, reason: 'same_day_and_type_different_time' },
          ];
          equivalent.needsReview = true;
          equivalent.reviewReasons = Array.from(new Set([...(equivalent.reviewReasons || []), 'conflicting_meeting']));
        } else equivalent.sessions.push(incoming);
      }
      const creditValues = new Set([equivalent.credits, candidate.credits].filter((v): v is number => v !== null && v !== undefined));
      if (creditValues.size > 1) {
        equivalent.credits = null;
        equivalent.creditHoursConflict = Array.from(creditValues).sort((a, b) => a - b);
        equivalent.needsReview = true;
        equivalent.reviewReasons = Array.from(new Set([...(equivalent.reviewReasons || []), 'credit_conflict']));
      } else if (equivalent.credits == null && candidate.credits != null) equivalent.credits = candidate.credits;
      if (!equivalent.instructor && candidate.instructor) equivalent.instructor = candidate.instructor;
      equivalent.reviewReasons = Array.from(new Set([...(equivalent.reviewReasons || []), ...(candidate.reviewReasons || [])]));
      equivalent.needsReview = Boolean(equivalent.needsReview || candidate.needsReview);
      return;
    }
    // Missing section codes are never merged solely on course identity. This is
    // essential when the same course has multiple unlabelled meetings.
    result.push(candidate);
  };

  if (tableHeaderIndex >= 0) {
    const headerCols = evidences[tableHeaderIndex].raw.split('\t').map((c) => c.trim().toLowerCase());
    for (const evidence of evidences.slice(tableHeaderIndex + 1)) {
      if (!evidence.raw.includes('\t')) continue;
      const cols = evidence.raw.split('\t').map((c) => c.trim());
      const valueFor = (patterns: RegExp[]) => {
        const idx = headerCols.findIndex((h) => patterns.some((p) => p.test(h)));
        return idx >= 0 ? cols[idx] || '' : '';
      };
      const code = parseCourseCode(valueFor([/course\s*code|subject\s*code|^code$/i])) || parseCourseCode(evidence.raw);
      const name = cleanNameCandidate(valueFor([/course\s*name|course\s*title|^title$|^subject$/i]), code)
        || cols.map((c) => cleanNameCandidate(c, code)).find(Boolean)
        || null;
      const sectionCode = valueFor([/^section$/i, /section\s*(?:code|id|number)/i]) || extractSection(evidence.raw, code);
      const credits = explicitCredit(valueFor([/^credits?$/i, /credit\s*hours?|^units?$/i]))
        ?? cols.map(explicitCredit).find((value): value is number => value !== null) ?? null;
      const sessions = cols.flatMap(extractSessionsFromSegment);
      const instructor = valueFor([/^instructor$/i, /professor|lecturer/i]) || null;
      if (name || code || sessions.length || credits !== null || sectionCode) {
        appendOrCreate(createTextSection(evidence.lineIndex, { name: name || code || '', code, sectionCode, credits, instructor, sessions }));
      }
    }
  }

  // Build order-independent local evidence blocks around course identities. A
  // meeting is allowed to appear before the code/title that identifies its
  // course. The nearest course anchor wins only within the same bounded block.
  // Prefer explicit course-code anchors whenever any are present. Title-only
  // lines near a coded course are supporting evidence, not separate courses.
  // Only fall back to title anchors when the entire text contains no course code.
  const codeAnchors = evidences.filter((e) => e.code);
  const anchors = codeAnchors.length > 0 ? codeAnchors : evidences.filter((e) => e.name);
  if (!anchors.length) {
    // No explicit course identity exists. Preserve labeled meeting/section/credit
    // evidence as reviewable records rather than inventing a course title.
    const orphan = evidences.filter((e) => e.sessions.length || e.sectionCode || e.credits !== null);
    for (const evidence of orphan) {
      if (!evidence.sessions.length && !evidence.sectionCode && evidence.credits === null) continue;
      appendOrCreate(createTextSection(evidence.lineIndex, {
        name: evidence.name || '', code: evidence.code, sectionCode: evidence.sectionCode,
        credits: evidence.credits, instructor: evidence.instructor, sessions: evidence.sessions,
      }));
    }
    return deduplicateParsedBatch(result);
  }

  const usedTableLines = new Set(tableHeaderIndex >= 0 ? evidences.slice(tableHeaderIndex).filter((e) => e.raw.includes('\t')).map((e) => e.lineIndex) : []);
  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[a];
    const nextAnchorLine = anchors[a + 1]?.lineIndex ?? Number.POSITIVE_INFINITY;
    const block = evidences.filter((e) => {
      if (usedTableLines.has(e.lineIndex)) return false;
      if (e.lineIndex < anchor.lineIndex - 4) return false;
      if (e.lineIndex >= nextAnchorLine) return false;
      return true;
    });

    // For a repeated course code with a different section/meeting, each anchor
    // becomes its own evidence block. This preserves multiple sections.
    const code = anchor.code || block.find((e) => e.code)?.code || null;
    let name = anchor.name || block.find((e) => e.name)?.name || null;
    const sectionCode = block.find((e) => e.sectionCode)?.sectionCode || null;
    const creditValues = block.map((e) => e.credits).filter((v): v is number => v !== null);
    const credits = creditValues.length && new Set(creditValues).size === 1 ? creditValues[0] : null;
    const creditConflict = new Set(creditValues).size > 1 ? Array.from(new Set(creditValues)).sort((x, y) => x - y) : null;
    if (!name) {
      // Do not manufacture a title from the code. Keep it empty and reviewable.
      name = '';
    }
    const sessions = extractSessionsFromSegment(block.map((e) => e.raw).join(' | '));
    const dedupedSessions: Session[] = [];
    for (const session of sessions) {
      if (!dedupedSessions.some((existing) => `${existing.day}|${existing.start}|${existing.end}|${existing.type || 'Other'}` === `${session.day}|${session.start}|${session.end}|${session.type || 'Other'}`)) {
        dedupedSessions.push(session);
      }
    }
    const instructor = block.find((e) => e.instructor)?.instructor || null;
    if (code || name || sectionCode || dedupedSessions.length || credits !== null) {
      const candidate = createTextSection(anchor.lineIndex, {
        name: name || '', code, sectionCode, credits, instructor, sessions: dedupedSessions,
      });
      if (creditConflict) {
        candidate.credits = null;
        candidate.creditHoursConflict = creditConflict;
        candidate.needsReview = true;
        candidate.reviewReasons = Array.from(new Set([...(candidate.reviewReasons || []), 'credit_conflict']));
      }
      appendOrCreate(candidate);
    }
  }

  // Preserve standalone evidence that was not captured by an identity block,
  // especially meetings that precede an anchor at the end of a pasted fragment.
  for (const evidence of evidences) {
    if (usedTableLines.has(evidence.lineIndex)) continue;
    if (!evidence.sessions.length || evidence.code || evidence.name) continue;
    const nearest = result
      .map((section, idx) => ({ section, idx, distance: Math.min(...anchors.map((a) => Math.abs(a.lineIndex - evidence.lineIndex))) }))
      .sort((x, y) => x.distance - y.distance)[0];
    if (nearest && nearest.distance <= 4) continue;
    appendOrCreate(createTextSection(evidence.lineIndex, {
      name: '', code: null, sectionCode: evidence.sectionCode, credits: evidence.credits,
      instructor: evidence.instructor, sessions: evidence.sessions,
    }));
  }

  return deduplicateParsedBatch(result);
}

