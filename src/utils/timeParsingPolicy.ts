export const AMBIGUOUS_BARE_HOURS = new Set<number>([1, 2, 3, 4, 5, 6, 7]);

function normalizeArabicDigits(raw: string): string {
  return String(raw || '')
    .replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x06F0));
}

function normalizeArabicAmPm(raw: string): string {
  return normalizeArabicDigits(raw)
    .replace(/(?:صباح(?:اً|ا)?|(?<=\d)\s*ص)(?![\u0600-\u06ff])/giu, ' AM ')
    .replace(/(?:مساء(?:ً|ا)?|(?<=\d)\s*م)(?![\u0600-\u06ff])/giu, ' PM ')
    .replace(/\b(?:a\.m\.)\b/gi, 'AM')
    .replace(/\b(?:p\.m\.)\b/gi, 'PM')
    .trim();
}

export function hasExplicitAmPm(raw: string): boolean {
  const value = normalizeArabicAmPm(raw).toLowerCase();
  return /(?:^|[\s\d])(am|pm)(?=$|[\s\d])/i.test(value);
}

export const hasExplicitAmPmAlias = hasExplicitAmPm;

export function isAmbiguousBareTime(raw: string): boolean {
  if (!raw || hasExplicitAmPm(raw)) return false;
  const normalized = normalizeArabicDigits(String(raw).trim());
  const colon = normalized.match(/^(\d{1,2})[:.]\d{1,2}$/);
  if (colon) return AMBIGUOUS_BARE_HOURS.has(Number(colon[1]));
  const digits = normalized.match(/^(\d{1,4})$/);
  if (!digits) return false;
  const value = digits[1];
  if (value.length === 4) return Number(value.slice(0, 2)) <= 23 && Number(value.slice(2)) <= 59;
  const hour = value.length <= 2 ? Number(value) : Number(value[0]);
  return AMBIGUOUS_BARE_HOURS.has(hour);
}

export function normalizeTimeWithPolicy(raw: string, isPMContext = false): string | null {
  if (!raw) return null;
  let clean = normalizeArabicAmPm(String(raw)).trim();
  if (!clean) return null;

  const explicitPM = /(?:^|[\d\s])(pm)(?=$|[\s\d])/i.test(clean);
  const explicitAM = /(?:^|[\d\s])(am)(?=$|[\s\d])/i.test(clean);

  // Strict parsing: do not delete arbitrary letters and then parse whatever digits remain.
  clean = clean.replace(/\s+/g, ' ').trim();
  const match = clean.match(/^(\d{1,4})(?::(\d{1,2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  const digitPart = match[1];
  const explicitSuffix = (match[3] || '').toLowerCase();
  let hours: number;
  let minutes: number;

  if (match[2] !== undefined) {
    hours = Number(digitPart);
    minutes = Number(match[2]);
  } else if (digitPart.length === 4) {
    hours = Number(digitPart.slice(0, 2));
    minutes = Number(digitPart.slice(2));
  } else if (digitPart.length === 3) {
    hours = Number(digitPart.slice(0, 1));
    minutes = Number(digitPart.slice(1));
  } else {
    hours = Number(digitPart);
    minutes = 0;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;

  if (explicitSuffix === 'am' || explicitAM) {
    if (hours === 12) hours = 0;
    if (hours > 12) return null;
  } else if (explicitSuffix === 'pm' || explicitPM || isPMContext) {
    if (hours < 12) hours += 12;
    if (hours > 23) return null;
  } else if (match[2] !== undefined) {
    // 24-hour colon form is valid only when hours are 0..23. Bare 1..12 remains literal
    // and may be flagged ambiguous by callers.
    if (hours > 23) return null;
  }

  if (hours < 0 || hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface TimeRangeParseResult {
  rawStart: string;
  rawEnd: string;
  startPmContext: boolean;
  endPmContext: boolean;
}

export function parseTimeRangeWithPolicy(raw: string): TimeRangeParseResult | null {
  if (!raw) return null;
  const normalized = normalizeArabicAmPm(raw)
    .replace(/\b(?:until|through)\b/gi, '-')
    .replace(/\s*(?:حتى|إلى|الى)\s*/gi, ' - ')
    .trim();
  const parts = normalized.split(/\s*(?:-|–|—|~|\bto\b)\s*/i).map(s => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;

  const rawStart = parts[0];
  const rawEnd = parts[1];
  const startExplicit = hasExplicitAmPm(rawStart);
  const endExplicit = hasExplicitAmPm(rawEnd);
  const startHasPM = /\bpm\b/i.test(rawStart);
  const endHasPM = /\bpm\b/i.test(rawEnd);
  let startPmContext = false;
  let endPmContext = false;

  if (!startExplicit && endExplicit && endHasPM) {
    // 1:00 - 2:30 PM => both endpoints are PM.
    const startMinutes = normalizeTimeWithPolicy(rawStart);
    const endMinutes = normalizeTimeWithPolicy(rawEnd);
    if (startMinutes && endMinutes) {
      const sh = Number(startMinutes.slice(0, 2));
      const eh = Number(endMinutes.slice(0, 2));
      if (sh < 12 && eh >= 12) startPmContext = true;
    } else if (/^\d{1,2}(?::\d{1,2})?$/.test(rawStart)) {
      startPmContext = true;
    }
  }

  if (startExplicit && startHasPM && !endExplicit) {
    // 1:00 PM - 2:30 => the end inherits PM context.
    const startMinutes = normalizeTimeWithPolicy(rawStart);
    if (startMinutes && /^\d{1,2}(?::\d{1,2})?$/.test(rawEnd)) {
      endPmContext = true;
    }
  }

  return { rawStart, rawEnd, startPmContext, endPmContext };
}
