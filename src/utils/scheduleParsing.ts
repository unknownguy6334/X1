import type { DayOfWeek } from '../types';

const EXACT_DAY_MAP: Record<string, DayOfWeek> = {
  sun: 'SUN', sunday: 'SUN', su: 'SUN', u: 'SUN',
  mon: 'MON', monday: 'MON', mo: 'MON', m: 'MON',
  tue: 'TUE', tues: 'TUE', tuesday: 'TUE', tu: 'TUE', t: 'TUE',
  wed: 'WED', wednesday: 'WED', we: 'WED', w: 'WED',
  thu: 'THU', thur: 'THU', thurs: 'THU', thursday: 'THU', r: 'THU', th: 'THU',
  fri: 'FRI', friday: 'FRI', fr: 'FRI', f: 'FRI',
  sat: 'SAT', saturday: 'SAT', sa: 'SAT', s: 'SAT',
  'السبت': 'SAT', 'سبت': 'SAT',
  'الاحد': 'SUN', 'الأحد': 'SUN', 'احد': 'SUN',
  'الاثنين': 'MON', 'الإثنين': 'MON', 'اثنين': 'MON', 'إثنين': 'MON',
  'الثلاثاء': 'TUE', 'ثلاثاء': 'TUE',
  'الاربعاء': 'WED', 'الأربعاء': 'WED', 'اربعاء': 'WED', 'أربعاء': 'WED',
  'الخميس': 'THU', 'خميس': 'THU',
  'الجمعة': 'FRI', 'جمعة': 'FRI',
  'ح': 'SUN', 'ن': 'MON', 'ث': 'TUE', 'ر': 'WED', 'خ': 'THU', 'س': 'SAT', 'ج': 'FRI',
};

const COMPACT_MAP: Record<string, DayOfWeek[]> = {
  mw: ['MON', 'WED'], mwf: ['MON', 'WED', 'FRI'], mtw: ['MON', 'TUE', 'WED'], mth: ['MON', 'THU'], mf: ['MON', 'FRI'],
  tr: ['TUE', 'THU'], tth: ['TUE', 'THU'], wf: ['WED', 'FRI'],
  'm-w': ['MON', 'WED'], 'm-th': ['MON', 'THU'], 't-th': ['TUE', 'THU'],
  'sat-wed': ['SAT', 'WED'], 'sat-tue': ['SAT', 'TUE'], 'sat-thu': ['SAT', 'THU'],
  'sun-tue': ['SUN', 'TUE'], 'sun-wed': ['SUN', 'WED'], 'sun-thu': ['SUN', 'THU'],
  'su-th': ['SUN', 'THU'], 'su-tu': ['SUN', 'TUE'], 'su-we': ['SUN', 'WED'],
  sath: ['SAT', 'THU'], satthu: ['SAT', 'THU'],
};

function addUnique(out: DayOfWeek[], day?: DayOfWeek) {
  if (day && !out.includes(day)) out.push(day);
}

export function resolveDayTokens(rawDay: string): DayOfWeek[] {
  if (!rawDay) return [];
  const clean = String(rawDay).trim().toLowerCase();
  if (!clean) return [];
  const normalizedArabic = clean
    .replace(/السبت/g, ' sat ')
    .replace(/الاحد|الأحد/g, ' sun ')
    .replace(/الاثنين|الإثنين/g, ' mon ')
    .replace(/الثلاثاء|ثلاثاء/g, ' tue ')
    .replace(/الاربعاء|الأربعاء|اربعاء|أربعاء/g, ' wed ')
    .replace(/الخميس/g, ' thu ')
    .replace(/الجمعة|جمعة/g, ' fri ');

  const compact = normalizedArabic.replace(/[\s,/&|]+/g, '');
  if (COMPACT_MAP[compact]) return [...COMPACT_MAP[compact]];

  const result: DayOfWeek[] = [];
  const tokens = normalizedArabic.split(/[,/&+|\s-]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (COMPACT_MAP[token]) {
      for (const day of COMPACT_MAP[token]) addUnique(result, day);
      continue;
    }
    addUnique(result, EXACT_DAY_MAP[token]);
  }

  if (result.length === 0 && /[\u0600-\u06FF]/.test(clean)) {
    for (const ch of clean) addUnique(result, EXACT_DAY_MAP[ch]);
  }
  return result;
}

export function resolveSessionType(rawType?: string): string {
  if (!rawType || !String(rawType).trim()) return 'Other';
  const lower = String(rawType).trim().toLowerCase();
  if (/\b(lab|laboratory|practical)\b|معمل|مختبر|عملي|عملى/u.test(lower)) return 'Lab';
  if (/\b(tutorial|tut)\b|تدريب|تطبيق/u.test(lower)) return 'Tutorial';
  if (/\b(discussion|disc)\b|مناقش/u.test(lower)) return 'Discussion';
  if (/\b(lecture|lec)\b|محاضرة|محاضره/u.test(lower)) return 'Lecture';
  if (/\b(section|sec)\b|سكشن|شعبة|شعبه|تمارين/u.test(lower)) return 'Section';
  if (/\b(recitation|recit)\b|استذكار/u.test(lower)) return 'Recitation';
  if (/\b(seminar)\b/iu.test(lower)) return 'Seminar';
  if (/\b(workshop)\b/iu.test(lower)) return 'Workshop';
  if (/\bonline|remote|distance|web\b|افتراضي|عن بعد|اونلاين|أونلاين|async/iu.test(lower)) return 'Online';
  return 'Other';
}
