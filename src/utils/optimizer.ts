import {
  AchievableCreditSummary,
  DayOfWeek,
  OptimizationResult,
  OptimizerOutput,
  SchedulePreferences,
  Section,
  Session,
} from '../types';
import { recordPerformanceMetric, startPerformanceTimer } from './performanceTelemetry';
import { formatCourseDisplay, getCourseIdentityKey, getScheduleSignature } from './courseUtils';
import {
  ALL_DAYS,
  DAYS,
  getScheduleDailySpanMinutes,
  compareSchedules,
  normalizeDay,
  timeToMinutes,
  formatMinutes,
  formatTime12,
  findSessionConflict,
  conflicts,
  sessionsConflict,
  hasInternalConflict,
} from './optimizerCore';

export {
  ALL_DAYS,
  DAYS,
  getScheduleDailySpanMinutes,
  compareSchedules,
  normalizeDay,
  timeToMinutes,
  formatMinutes,
  formatTime12,
  findSessionConflict,
  conflicts,
  sessionsConflict,
  hasInternalConflict,
} from './optimizerCore';

const DEFAULT_DAY_BUCKETS = [1, 2, 3, 4, 5, 6, 7] as const;
const RESULT_LIMIT_PER_DAY = 5;
const EPSILON = 0.001;

export interface OptimizerSearchBudget {
  maxCourseSubsetNodes: number;
  maxSectionNodes: number;
  maxResultsRetained: number;
}

export const DEFAULT_SEARCH_BUDGET: OptimizerSearchBudget = {
  maxCourseSubsetNodes: 50_000,
  maxSectionNodes: 150_000,
  maxResultsRetained: 35,
};

export const ESTIMATE_SEARCH_BUDGET: OptimizerSearchBudget = {
  maxCourseSubsetNodes: 8_000,
  maxSectionNodes: 20_000,
  maxResultsRetained: 7,
};

export const DIAGNOSTIC_SEARCH_BUDGET: OptimizerSearchBudget = {
  maxCourseSubsetNodes: 1_500,
  maxSectionNodes: 5_000,
  maxResultsRetained: 7,
};

type OptimizerMode = 'full' | 'estimate' | 'diagnostic';

type CreditState = {
  status: 'known' | 'unknown' | 'conflicting';
  value: number | null;
};

type NormalizedSection = {
  section: Section;
  sessions: Array<{ day: DayOfWeek; start: number; end: number; session: Session }>;
  days: Set<DayOfWeek>;
  credit: number | null;
};

type SearchState = {
  sections: Section[];
  intervalsByDay: Record<DayOfWeek, Array<{ start: number; end: number }>>;
  occupiedDays: Set<DayOfWeek>;
  totalGap: number;
  totalCredits: number;
  earliestStartMinutes: number;
  latestEndMinutes: number;
};

type SearchControl = {
  mode: OptimizerMode;
  budget: OptimizerSearchBudget;
  courseSubsetNodes: number;
  sectionNodes: number;
  capped: boolean;
  cancelled: boolean;
  shouldCancel?: () => boolean;
};

export interface OptimizerParams {
  courses: Record<string, Section[]>;
  fixedCourses: Section[];
  targetCredits?: number;
  preferences: SchedulePreferences;
  shouldCancel?: () => boolean;
  mode?: OptimizerMode;
  searchBudget?: Partial<OptimizerSearchBudget>;
}

function resolveBudget(partial?: Partial<OptimizerSearchBudget>, mode: OptimizerMode = 'full'): OptimizerSearchBudget {
  const base = mode === 'estimate' ? ESTIMATE_SEARCH_BUDGET : mode === 'diagnostic' ? DIAGNOSTIC_SEARCH_BUDGET : DEFAULT_SEARCH_BUDGET;
  return {
    maxCourseSubsetNodes: Math.max(1, Math.floor(partial?.maxCourseSubsetNodes ?? base.maxCourseSubsetNodes)),
    maxSectionNodes: Math.max(1, Math.floor(partial?.maxSectionNodes ?? base.maxSectionNodes)),
    maxResultsRetained: Math.max(1, Math.floor(partial?.maxResultsRetained ?? base.maxResultsRetained)),
  };
}

function createSearchControl(params: OptimizerParams, mode: OptimizerMode): SearchControl {
  return {
    mode,
    budget: resolveBudget(params.searchBudget, mode),
    courseSubsetNodes: 0,
    sectionNodes: 0,
    capped: false,
    cancelled: false,
    shouldCancel: params.shouldCancel,
  };
}

function stopRequested(control: SearchControl): boolean {
  if (control.cancelled || control.capped) return true;
  if (control.shouldCancel?.()) {
    control.cancelled = true;
    return true;
  }
  return false;
}

function markCourseNode(control: SearchControl): boolean {
  if (stopRequested(control)) return false;
  control.courseSubsetNodes += 1;
  if (control.courseSubsetNodes > control.budget.maxCourseSubsetNodes) {
    control.capped = true;
    return false;
  }
  return true;
}

function markSectionNode(control: SearchControl): boolean {
  if (stopRequested(control)) return false;
  control.sectionNodes += 1;
  if (control.sectionNodes > control.budget.maxSectionNodes) {
    control.capped = true;
    return false;
  }
  return true;
}

function uniqueCourseMap(courses: Record<string, Section[]>): Record<string, Section[]> {
  const normalized: Record<string, Section[]> = {};

  for (const [rawDisplay, sections] of Object.entries(courses || {})) {
    const candidates = Array.isArray(sections) ? sections : [];
    if (candidates.length === 0) continue;
    const fallbackName = rawDisplay.includes(':') ? rawDisplay.slice(rawDisplay.indexOf(':') + 1).trim() : rawDisplay.trim();
    const first = candidates[0];
    const courseKey = first?.courseKey || getCourseIdentityKey(first?.courseCode || null, first?.name || fallbackName);
    if (!courseKey) continue;
    if (!normalized[courseKey]) normalized[courseKey] = [];

    for (const section of candidates) {
      const normalizedSection: Section = {
        ...section,
        courseKey,
        name: section.name?.trim() || first.name?.trim() || fallbackName,
      };
      normalized[courseKey].push(normalizedSection);
    }
  }

  for (const courseKey of Object.keys(normalized)) {
    const seen = new Set<string>();
    normalized[courseKey] = normalized[courseKey].filter((section) => {
      const signature = `${section.id.trim().toLowerCase()}:::${section.sectionCode ? section.sectionCode.trim().toLowerCase() : ''}:::${section.sessions
        .map((session) => `${session.day}:${session.start}-${session.end}:${session.type || ''}:${session.type === 'Custom' ? (session.customType || '').trim().toLowerCase() : ''}`)
        .sort()
        .join('|')}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  return normalized;
}

function mandatoryCourseKeys(preferences: SchedulePreferences): Set<string> {
  return new Set((preferences.mandatoryCourseKeys || [])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim().toLowerCase()));
}

function normalizeCreditState(sections: Section[]): CreditState {
  const values = sections
    .flatMap((section) => {
      if (Array.isArray(section.creditHoursConflict) && section.creditHoursConflict.length > 1) {
        return section.creditHoursConflict.filter((value) => Number.isFinite(value));
      }
      return Number.isFinite(section.credits ?? NaN) ? [Number(section.credits)] : [];
    })
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return { status: 'unknown', value: null };
  const unique = Array.from(new Set(values.map((value) => Math.round(value * 1000) / 1000)));
  if (unique.length !== 1) return { status: 'conflicting', value: null };
  return { status: 'known', value: unique[0] };
}

function normalizeSection(section: Section): NormalizedSection | null {
  if (!section || !Array.isArray(section.sessions) || section.sessions.length === 0) return null;
  if (hasInternalConflict(section.sessions)) return null;

  const sessions: NormalizedSection['sessions'] = [];
  const days = new Set<DayOfWeek>();
  for (const session of section.sessions) {
    const day = normalizeDay(session.day);
    const start = timeToMinutes(session.start);
    const end = timeToMinutes(session.end);
    // Gadwal currently models every schedulable meeting as a real day/time interval.
    // Missing day/time data is therefore intentionally invalid rather than inferred.
    if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
    sessions.push({ day, start, end, session: { ...session, day } });
    days.add(day);
  }
  return {
    section,
    sessions,
    days,
    credit: Number.isFinite(section.credits ?? NaN) ? Number(section.credits) : null,
  };
}

function validateSection(section: Section): boolean {
  return normalizeSection(section) !== null;
}

function fixedCourseKeys(fixedCourses: Section[]): string[] {
  return fixedCourses.map((section) => (section.courseKey || getCourseIdentityKey(section.courseCode, section.name)).trim()).filter(Boolean);
}

function fixedConflict(fixedCourses: Section[]): { invalid: boolean; duplicateCourseKey?: string } {
  const seen = new Set<string>();
  for (let i = 0; i < fixedCourses.length; i += 1) {
    if (!validateSection(fixedCourses[i])) return { invalid: true };
    const key = fixedCourseKeys([fixedCourses[i]])[0].toLowerCase();
    if (seen.has(key)) return { invalid: false, duplicateCourseKey: key };
    seen.add(key);
    for (let j = i + 1; j < fixedCourses.length; j += 1) {
      if (sessionsConflict(fixedCourses[i].sessions, fixedCourses[j].sessions)) return { invalid: true };
    }
  }
  return { invalid: false };
}

function conflictsWithChosen(candidate: Section, fixedCourses: Section[], chosen: Section[]): boolean {
  for (const fixed of fixedCourses) {
    if (sessionsConflict(fixed.sessions, candidate.sessions)) return true;
  }
  for (const current of chosen) {
    if (sessionsConflict(current.sessions, candidate.sessions)) return true;
  }
  return false;
}

export function calculateMetrics(sections: Section[]): {
  days: DayOfWeek[];
  numDays: number;
  totalGap: number;
  totalCredits: number;
  earliestStartMinutes: number;
  latestEndMinutes: number;
} | null {
  const daySessions: Record<DayOfWeek, Session[]> = { SAT: [], SUN: [], MON: [], TUE: [], WED: [], THU: [], FRI: [] };
  let totalCredits = 0;
  let earliestStartMinutes = Number.POSITIVE_INFINITY;
  let latestEndMinutes = 0;

  for (const section of sections) {
    if (Number.isFinite(section.credits ?? NaN)) totalCredits += Number(section.credits);
    for (const session of section.sessions) {
      const day = normalizeDay(session.day);
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (!day || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
      daySessions[day].push({ ...session, day });
      earliestStartMinutes = Math.min(earliestStartMinutes, start);
      latestEndMinutes = Math.max(latestEndMinutes, end);
    }
  }

  const days = ALL_DAYS.filter((day) => daySessions[day].length > 0);
  let totalGap = 0;
  for (const day of ALL_DAYS) {
    const sessionsForDay = [...daySessions[day]].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    for (let i = 1; i < sessionsForDay.length; i += 1) {
      totalGap += Math.max(0, timeToMinutes(sessionsForDay[i].start) - timeToMinutes(sessionsForDay[i - 1].end));
    }
  }

  return {
    days,
    numDays: days.length,
    totalGap,
    totalCredits,
    earliestStartMinutes: Number.isFinite(earliestStartMinutes) ? earliestStartMinutes : 0,
    latestEndMinutes,
  };
}

function createEmptySearchState(): SearchState {
  return {
    sections: [],
    intervalsByDay: { SAT: [], SUN: [], MON: [], TUE: [], WED: [], THU: [], FRI: [] },
    occupiedDays: new Set(),
    totalGap: 0,
    totalCredits: 0,
    earliestStartMinutes: Number.POSITIVE_INFINITY,
    latestEndMinutes: 0,
  };
}

function insertInterval(state: SearchState, day: DayOfWeek, start: number, end: number): void {
  const list = state.intervalsByDay[day];
  let index = 0;
  while (index < list.length && list[index].start < start) index += 1;
  const previous = list[index - 1];
  const next = list[index];
  if (previous && next) state.totalGap -= Math.max(0, next.start - previous.end);
  if (previous) state.totalGap += Math.max(0, start - previous.end);
  if (next) state.totalGap += Math.max(0, next.start - end);
  list.splice(index, 0, { start, end });
}

function removeInterval(state: SearchState, day: DayOfWeek, start: number, end: number): void {
  const list = state.intervalsByDay[day];
  const index = list.findIndex((item) => item.start === start && item.end === end);
  if (index < 0) return;
  const previous = list[index - 1];
  const next = list[index + 1];
  if (previous) state.totalGap -= Math.max(0, start - previous.end);
  if (next) state.totalGap -= Math.max(0, next.start - end);
  if (previous && next) state.totalGap += Math.max(0, next.start - previous.end);
  list.splice(index, 1);
}

function addNormalizedSection(state: SearchState, normalized: NormalizedSection): void {
  for (const session of normalized.sessions) insertInterval(state, session.day, session.start, session.end);
  for (const day of normalized.days) state.occupiedDays.add(day);
  state.sections.push(normalized.section);
  if (normalized.credit != null) state.totalCredits += normalized.credit;
  for (const session of normalized.sessions) {
    state.earliestStartMinutes = Math.min(state.earliestStartMinutes, session.start);
    state.latestEndMinutes = Math.max(state.latestEndMinutes, session.end);
  }
}

function removeNormalizedSection(state: SearchState, normalized: NormalizedSection): void {
  for (let i = normalized.sessions.length - 1; i >= 0; i -= 1) {
    const session = normalized.sessions[i];
    removeInterval(state, session.day, session.start, session.end);
  }
  state.sections.pop();
  if (normalized.credit != null) state.totalCredits -= normalized.credit;
  state.occupiedDays.clear();
  for (const section of state.sections) {
    for (const session of section.sessions) {
      const day = normalizeDay(session.day);
      if (day) state.occupiedDays.add(day);
    }
  }
  state.earliestStartMinutes = Number.POSITIVE_INFINITY;
  state.latestEndMinutes = 0;
  for (const section of state.sections) {
    for (const session of section.sessions) {
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (Number.isFinite(start)) state.earliestStartMinutes = Math.min(state.earliestStartMinutes, start);
      if (Number.isFinite(end)) state.latestEndMinutes = Math.max(state.latestEndMinutes, end);
    }
  }
}

function stateToMetrics(state: SearchState): ReturnType<typeof calculateMetrics> {
  return {
    days: ALL_DAYS.filter((day) => state.intervalsByDay[day].length > 0),
    numDays: state.occupiedDays.size,
    totalGap: state.totalGap,
    totalCredits: Math.round(state.totalCredits * 1000) / 1000,
    earliestStartMinutes: Number.isFinite(state.earliestStartMinutes) ? state.earliestStartMinutes : 0,
    latestEndMinutes: state.latestEndMinutes,
  };
}

function scheduleMatchesHardPreferences(
  sections: Section[],
  preferences: SchedulePreferences,
  metrics: NonNullable<ReturnType<typeof calculateMetrics>>,
): boolean {
  const freeDays = new Set(preferences.freeDays || []);
  const earliest = preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' ? timeToMinutes(preferences.earliestStartTime) : null;
  const latest = preferences.latestEndTime && preferences.latestEndTime !== 'ANY' ? timeToMinutes(preferences.latestEndTime) : null;
  if (earliest !== null && !Number.isFinite(earliest)) return false;
  if (latest !== null && !Number.isFinite(latest)) return false;
  if (preferences.maxDays != null && metrics.numDays > preferences.maxDays) return false;
  if (preferences.dayBuckets?.length && !preferences.dayBuckets.includes(metrics.numDays)) return false;
  for (const section of sections) {
    for (const session of section.sessions || []) {
      const day = normalizeDay(session.day);
      const start = timeToMinutes(session.start);
      const end = timeToMinutes(session.end);
      if (!day || !Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (freeDays.has(day)) return false;
      if (earliest !== null && start < earliest) return false;
      if (latest !== null && end > latest) return false;
    }
  }
  if (preferences.useCreditRange) {
    const min = preferences.minCredits;
    const max = preferences.maxCredits;
    if (min != null && metrics.totalCredits < min - EPSILON) return false;
    if (max != null && metrics.totalCredits > max + EPSILON) return false;
  }
  return true;
}

export function compareSchedulesForPreferences(a: OptimizationResult, b: OptimizationResult, preferences: SchedulePreferences): number {
  const gapDiff = a.totalGap - b.totalGap;
  if (gapDiff !== 0) return gapDiff;
  const dayDiff = a.numDays - b.numDays;
  if (dayDiff !== 0) return dayDiff;
  if (preferences.preferCompactDays) {
    const spanDiff = getScheduleDailySpanMinutes(a) - getScheduleDailySpanMinutes(b);
    if (spanDiff !== 0) return spanDiff;
  }
  return 0;
}

/** Deterministic display/storage order after all user-facing ranking criteria are tied. */
export function compareSchedulesDeterministically(a: OptimizationResult, b: OptimizationResult, preferences: SchedulePreferences): number {
  const rankingDiff = compareSchedulesForPreferences(a, b, preferences);
  if (rankingDiff !== 0) return rankingDiff;
  return getScheduleSignature(a).localeCompare(getScheduleSignature(b));
}

function insertTopResult(target: OptimizationResult[], candidate: OptimizationResult, preferences: SchedulePreferences): void {
  const cmp = (a: OptimizationResult, b: OptimizationResult) => compareSchedulesDeterministically(a, b, preferences);
  let low = 0;
  let high = target.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cmp(target[mid], candidate) <= 0) low = mid + 1;
    else high = mid;
  }
  target.splice(low, 0, candidate);
  if (target.length > RESULT_LIMIT_PER_DAY) target.pop();
}

function finaliseTies(schedules: OptimizationResult[], preferences: SchedulePreferences, globalRanks?: Map<string, number>): OptimizationResult[] {
  const ordered = [...schedules].sort((a, b) => compareSchedulesDeterministically(a, b, preferences));
  return ordered.map((schedule, index, array) => {
    const previous = array[index - 1];
    const next = array[index + 1];
    const tied = Boolean((previous && compareSchedulesForPreferences(previous, schedule, preferences) === 0) || (next && compareSchedulesForPreferences(schedule, next, preferences) === 0));
    return {
      ...schedule,
      isTie: tied,
      tieReason: tied ? 'Tied under the same gap/day/compactness ranking criteria' : undefined,
      scheduleSignature: schedule.scheduleSignature || getScheduleSignature(schedule),
      categoryRank: index + 1,
      globalRank: globalRanks?.get(schedule.id),
    };
  });
}

function canAddSectionEarly(
  normalized: NormalizedSection,
  state: SearchState,
  preferences: SchedulePreferences,
  fixedSectionCount: number,
  chosenCourseCount: number,
  totalTargetCredits: number | null,
  creditRangeMax: number | null,
): boolean {
  const freeDays = new Set(preferences.freeDays || []);
  const earliest = preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' ? timeToMinutes(preferences.earliestStartTime) : null;
  const latest = preferences.latestEndTime && preferences.latestEndTime !== 'ANY' ? timeToMinutes(preferences.latestEndTime) : null;
  for (const session of normalized.sessions) {
    if (freeDays.has(session.day)) return false;
    if (earliest !== null && session.start < earliest) return false;
    if (latest !== null && session.end > latest) return false;
    const existing = state.intervalsByDay[session.day];
    for (const interval of existing) {
      if (session.start < interval.end && interval.start < session.end) return false;
    }
  }
  const newDays = new Set(state.occupiedDays);
  for (const day of normalized.days) newDays.add(day);
  if (preferences.maxDays != null && newDays.size > preferences.maxDays) return false;
  if (preferences.dayBuckets?.length && newDays.size > Math.max(...preferences.dayBuckets)) return false;

  const credit = normalized.credit;
  if (totalTargetCredits != null) {
    if (credit == null) return false;
    const nextCredits = state.totalCredits + credit;
    if (nextCredits > totalTargetCredits + EPSILON) return false;
  }
  if (creditRangeMax != null && credit != null && state.totalCredits + credit > creditRangeMax + EPSILON) return false;
  if (preferences.targetCourseCount != null && fixedSectionCount + chosenCourseCount + 1 > preferences.targetCourseCount) return false;
  return true;
}

function diagnosticRelaxations(preferences: SchedulePreferences): Array<{ key: string; label: string; update: Partial<SchedulePreferences> }> {
  const list: Array<{ key: string; label: string; update: Partial<SchedulePreferences> }> = [];
  if ((preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY') || (preferences.latestEndTime && preferences.latestEndTime !== 'ANY')) {
    list.push({ key: 'clear_time_limits', label: 'Remove time limits', update: { earliestStartTime: 'ANY', latestEndTime: 'ANY' } });
  }
  if ((preferences.freeDays || []).length > 0) list.push({ key: 'clear_free_days', label: 'Allow classes on your free days', update: { freeDays: [] } });
  const requestedBuckets = preferences.dayBuckets || [];
  if (requestedBuckets.length > 0 && requestedBuckets.length < 7) list.push({ key: 'allow_all_days', label: 'Allow any number of campus days', update: { dayBuckets: [...DEFAULT_DAY_BUCKETS] } });
  if (preferences.maxDays != null) list.push({ key: 'relax_max_days', label: 'Allow more campus days', update: { maxDays: null, dayBuckets: preferences.dayBuckets?.length ? preferences.dayBuckets : [...DEFAULT_DAY_BUCKETS] } });
  if (preferences.targetCredits != null || preferences.useCreditRange || preferences.targetCourseCount != null) {
    list.push({ key: 'relax_exact_targets', label: 'Relax exact credit/course targets', update: { targetCredits: null, targetCourseCount: null, useCreditRange: false, minCredits: undefined, maxCredits: undefined } });
  }
  return list;
}

function actionTypeForDiagnostic(key: string): NonNullable<NonNullable<OptimizerOutput['impossibleDiagnostic']>['actionType']> | undefined {
  if (key === 'clear_time_limits') return 'clear_time_limits';
  if (key === 'clear_free_days') return 'clear_free_days';
  if (key === 'allow_all_days') return 'allow_all_days';
  if (key === 'relax_max_days') return 'relax_max_days';
  if (key === 'relax_exact_targets') return 'auto_adjust_credits';
  return undefined;
}

/** Shared section-branch traversal used by every search mode. The caller owns
 * constraint/state updates through onSection and receives one immutable leaf list. */
function enumerateSectionCombinations(
  sectionLists: Section[][],
  control: SearchControl,
  onSection: (section: Section, chosen: Section[]) => (() => void) | null,
  onLeaf: (chosen: Section[]) => void,
): void {
  const chosen: Section[] = [];
  const visit = (depth: number) => {
    if (!markSectionNode(control)) return;
    if (depth === sectionLists.length) {
      onLeaf([...chosen]);
      return;
    }
    for (const section of sectionLists[depth] || []) {
      if (stopRequested(control)) return;
      const undo = onSection(section, chosen);
      if (!undo) continue;
      chosen.push(section);
      visit(depth + 1);
      chosen.pop();
      undo();
    }
  };
  visit(0);
}

/** Shared exhaustive traversal used by both the normal optimizer and achievable-credit analysis. */
function enumerateCourseSubsets(
  subjects: string[],
  mandatorySubjects: string[],
  targetCourseCount: number | null,
  targetCredits: number | null,
  creditsByCourse: Map<string, number>,
  onSubset: (subset: string[]) => void,
  control?: SearchControl,
  fixedCount = 0,
): void {
  const mandatorySet = new Set(mandatorySubjects);
  const electiveSubjects = subjects.filter((subject) => !mandatorySet.has(subject));
  const mandatoryCredits = mandatorySubjects.reduce((sum, key) => sum + (creditsByCourse.get(key) ?? 0), 0);
  const remainingTarget = targetCredits == null ? null : targetCredits - mandatoryCredits;
  if (remainingTarget != null && remainingTarget < -EPSILON) return;

  const chosen: string[] = [];
  const recurse = (index: number, currentCredits: number) => {
    if (control && !markCourseNode(control)) return;
    if (index >= electiveSubjects.length) {
      if (remainingTarget != null && Math.abs(currentCredits - remainingTarget) > EPSILON) return;
      if (targetCourseCount != null && fixedCount + mandatorySubjects.length + chosen.length !== targetCourseCount) return;
      const subset = [...mandatorySubjects, ...chosen];
      if (subset.length > 0 || fixedCount > 0) onSubset(subset);
      return;
    }

    const remainingCount = electiveSubjects.length - index;
    if (targetCourseCount != null) {
      const needed = targetCourseCount - fixedCount - mandatorySubjects.length - chosen.length;
      if (needed < 0 || needed > remainingCount) return;
    }

    const subject = electiveSubjects[index];
    recurse(index + 1, currentCredits);

    const credit = creditsByCourse.get(subject);
    if (remainingTarget != null && credit == null) return;
    const nextCredits = currentCredits + (credit ?? 0);
    if (remainingTarget != null && nextCredits > remainingTarget + EPSILON) return;
    chosen.push(subject);
    recurse(index + 1, nextCredits);
    chosen.pop();
  };

  if (electiveSubjects.length === 0) {
    if (targetCourseCount == null || fixedCount + mandatorySubjects.length === targetCourseCount) {
      if (remainingTarget == null || Math.abs(remainingTarget) <= EPSILON) onSubset([...mandatorySubjects]);
    }
    return;
  }
  recurse(0, 0);
}

export function computeAllAchievableCredits(
  courses: Record<string, Section[]>,
  fixedCourses: Section[] = [],
  mandatoryCourses: string[] = [],
): (AchievableCreditSummary[] & { nodesEvaluated?: number; wasCapped?: boolean }) {
  const normalizedCourses = uniqueCourseMap(courses);
  const fixedConflictState = fixedConflict(fixedCourses);
  if (fixedConflictState.invalid || fixedConflictState.duplicateCourseKey) return [];

  const fixedNorms = new Set(fixedCourseKeys(fixedCourses));
  const requestedMandatory = new Set(mandatoryCourses.map((value) => String(value).trim()));
  const validCourses: Record<string, Section[]> = {};
  const creditsByCourse = new Map<string, number>();
  for (const [key, sections] of Object.entries(normalizedCourses)) {
    const valid = sections.filter(validateSection);
    if (valid.length > 0) validCourses[key] = valid;
    const credit = normalizeCreditState(valid);
    if (credit.status === 'known' && credit.value != null) creditsByCourse.set(key, credit.value);
  }
  const candidateSubjects = Object.keys(validCourses)
    .filter((key) => !fixedNorms.has(key))
    .filter((key) => creditsByCourse.has(key))
    .sort();
  const mandatorySubjects = candidateSubjects.filter((key) => requestedMandatory.has(key));
  const stats = new Map<number, { count: number; countWithoutMandatory: number }>();
  const control = createSearchControl({ courses, fixedCourses, preferences: { targetCredits: null, targetCourseCount: null, mandatoryCourses: [], mandatoryCourseKeys: [] } }, 'estimate');

  const recordSubset = (subjects: string[]) => {
    if (stopRequested(control)) return;
    if (subjects.length === 0) {
      const metrics = calculateMetrics(fixedCourses);
      if (metrics && metrics.totalCredits > 0 && fixedCourses.every((section) => Number.isFinite(section.credits ?? NaN))) {
        stats.set(metrics.totalCredits, { count: 1, countWithoutMandatory: 1 });
      }
      return;
    }
    const sectionLists = subjects.map((subject) => validCourses[subject] || []);
    enumerateSectionCombinations(
      sectionLists,
      control,
      (section, chosen) => {
        if (!validateSection(section) || conflictsWithChosen(section, fixedCourses, chosen)) return null;
        return () => {};
      },
      (chosen) => {
        const metrics = calculateMetrics([...fixedCourses, ...chosen]);
        if (!metrics || metrics.totalCredits <= 0 || fixedCourses.some((section) => !Number.isFinite(section.credits ?? NaN))) return;
        const current = stats.get(metrics.totalCredits) || { count: 0, countWithoutMandatory: 0 };
        current.countWithoutMandatory += 1;
        current.count += 1;
        stats.set(metrics.totalCredits, current);
      },
    );
  };

  enumerateCourseSubsets(candidateSubjects, mandatorySubjects, null, null, creditsByCourse, recordSubset, control, fixedCourses.length);
  const result = Array.from(stats.entries()).map(([credits, value]) => ({ credits, count: value.count, countWithoutMandatory: value.countWithoutMandatory })).sort((a, b) => a.credits - b.credits) as AchievableCreditSummary[] & { nodesEvaluated?: number; wasCapped?: boolean };
  result.nodesEvaluated = control.sectionNodes;
  result.wasCapped = control.capped;
  return result;
}

function createBaseOutput(requestedBuckets: number[], preferences: SchedulePreferences, allSectionsConsidered: Section[]): OptimizerOutput {
  return {
    allSectionsConsidered,
    byDayCount: Object.fromEntries(requestedBuckets.map((day) => [day, []])) as Record<number, OptimizationResult[]>,
    totalFoundByDay: Object.fromEntries(requestedBuckets.map((day) => [day, 0])),
    totalCombinationsEvaluated: 0,
    searchCompleteness: 'not_searched',
    wasCapped: false,
    wasSampled: false,
    searchStats: { candidateCourseSubsets: 0, schedulesEvaluated: 0, schedulesReturned: 0 },
    preferencesUsed: preferences,
  };
}

export function runOptimizer({ courses, fixedCourses, preferences, shouldCancel, mode = 'full', searchBudget }: OptimizerParams): OptimizerOutput {
  const perfTimer = startPerformanceTimer();
  const normalizedCourses = uniqueCourseMap(courses);
  const fixed = Array.isArray(fixedCourses) ? fixedCourses.map((section) => ({ ...section, courseKey: section.courseKey || getCourseIdentityKey(section.courseCode, section.name) })) : [];
  const requestedBuckets = Array.from(new Set(
    (preferences.dayBuckets && preferences.dayBuckets.length > 0 ? preferences.dayBuckets : DEFAULT_DAY_BUCKETS)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
  )).sort((a, b) => a - b);
  const output = createBaseOutput(requestedBuckets, preferences, [...fixed, ...Object.values(normalizedCourses).flat()]);
  const control = createSearchControl({ courses, fixedCourses: fixed, preferences, shouldCancel, mode, searchBudget }, mode);

  const fixedConflictState = fixedConflict(fixed);
  if (fixedConflictState.invalid) {
    output.impossibleDiagnostic = { reason: 'One or more selected sections have invalid or overlapping meeting times.', suggestion: 'Review the selected section meeting times.' };
    return output;
  }
  if (fixedConflictState.duplicateCourseKey) {
    output.impossibleDiagnostic = { reason: `The fixed schedule contains more than one section of the same course (${fixedConflictState.duplicateCourseKey}).`, suggestion: 'Keep only one section for each course before building.' };
    return output;
  }

  const fixedKeys = new Set(fixedCourseKeys(fixed));
  const candidateSubjects = Object.keys(normalizedCourses).filter((key) => !fixedKeys.has(key)).sort((a, b) => a.localeCompare(b));
  const mandatorySet = mandatoryCourseKeys(preferences);
  const mandatoryLabels = Array.from(mandatorySet);
  const displayByCourseKey = new Map<string, string>();
  for (const [courseKey, sections] of Object.entries(normalizedCourses)) {
    const section = sections[0];
    displayByCourseKey.set(courseKey, formatCourseDisplay(section?.courseCode, section?.name) || courseKey);
  }

  const validCourses: Record<string, Section[]> = {};
  const creditStates = new Map<string, CreditState>();
  const creditsByCourse = new Map<string, number>();
  const creditConstraintActive = (preferences.targetCredits != null && preferences.targetCredits > 0) || preferences.useCreditRange === true;
  for (const subject of candidateSubjects) {
    const valid = (normalizedCourses[subject] || []).filter(validateSection);
    if (valid.length > 0) validCourses[subject] = valid;
    const creditState = normalizeCreditState(valid);
    creditStates.set(subject, creditState);
    if (creditState.status === 'known' && creditState.value != null) creditsByCourse.set(subject, creditState.value);
  }

  const mandatorySubjects: string[] = [];
  const unschedulableMandatory: string[] = [];
  const missingMandatoryCourses: string[] = [];
  for (const required of mandatoryLabels) {
    const exactKey = candidateSubjects.find((key) => key.toLowerCase() === required.toLowerCase());
    if (fixedKeys.has(required) || Array.from(fixedKeys).some((key) => key.toLowerCase() === required.toLowerCase())) continue;
    if (!exactKey) {
      missingMandatoryCourses.push(displayByCourseKey.get(required) || required);
      continue;
    }
    if (!validCourses[exactKey] || validCourses[exactKey].length === 0) {
      unschedulableMandatory.push(displayByCourseKey.get(exactKey) || exactKey);
      continue;
    }
    if (creditConstraintActive && creditStates.get(exactKey)?.status !== 'known') {
      unschedulableMandatory.push(`${displayByCourseKey.get(exactKey) || exactKey} (credit data is ${creditStates.get(exactKey)?.status || 'unknown'})`);
      continue;
    }
    mandatorySubjects.push(exactKey);
  }

  if (missingMandatoryCourses.length > 0 || unschedulableMandatory.length > 0) {
    output.impossibleDiagnostic = {
      reason: `A required course could not be scheduled: ${[...missingMandatoryCourses, ...unschedulableMandatory].join(', ')}.`,
      suggestion: creditConstraintActive && unschedulableMandatory.some((name) => name.includes('credit data'))
        ? 'Resolve the missing or conflicting credits for every required course, then build again.'
        : 'Add or repair a valid section for every required course.',
      actionType: 'unmark_mandatory',
      actionLabel: 'Review must-take courses',
    };
    return output;
  }

  const fixedCreditStates = fixed.map((section) => normalizeCreditState([section]));
  const fixedCreditsKnown = fixedCreditStates.every((state) => state.status === 'known');
  if (creditConstraintActive && !fixedCreditsKnown) {
    output.impossibleDiagnostic = {
      reason: 'The fixed schedule contains a course with unknown or conflicting credits, so a credit-constrained search cannot be verified exactly.',
      suggestion: 'Resolve the fixed course credit data before using an exact credit target or credit range.',
    };
    return output;
  }

  const fixedCredits = fixedCreditStates.reduce((sum, state) => sum + (state.value ?? 0), 0);
  const targetCredits = preferences.targetCredits != null && preferences.targetCredits > 0 ? preferences.targetCredits : null;
  const targetCourseCount = preferences.targetCourseCount != null && preferences.targetCourseCount > 0 ? preferences.targetCourseCount : null;
  const minRange = preferences.useCreditRange ? (preferences.minCredits ?? null) : null;
  const maxRange = preferences.useCreditRange ? (preferences.maxCredits ?? null) : null;

  if (targetCourseCount != null && fixed.length > targetCourseCount) {
    output.impossibleDiagnostic = { reason: `The fixed schedule already contains ${fixed.length} courses, above your target of ${targetCourseCount}.`, suggestion: 'Increase the course target or remove one fixed course.' };
    return output;
  }
  if (targetCredits != null && fixedCredits > targetCredits + EPSILON) {
    output.impossibleDiagnostic = { reason: `Your fixed courses already total ${fixedCredits} credits, above the ${targetCredits}-credit target.`, suggestion: 'Choose a higher target or change the fixed courses.' };
    return output;
  }
  if (minRange != null && fixedCredits > (maxRange ?? Number.POSITIVE_INFINITY) + EPSILON) {
    output.impossibleDiagnostic = { reason: `Your fixed courses already exceed the ${maxRange}-credit maximum.`, suggestion: 'Increase the credit maximum or change the fixed courses.' };
    return output;
  }

  const candidateForSearch = candidateSubjects.filter((key) => {
    if (!validCourses[key]) return false;
    if (mandatorySubjects.includes(key)) return true;
    if (!creditConstraintActive) return true;
    return creditStates.get(key)?.status === 'known';
  });
  const electiveSubjects = candidateForSearch.filter((key) => !mandatorySubjects.includes(key));
  const topByDay: Record<number, OptimizationResult[]> = Object.fromEntries(requestedBuckets.map((day) => [day, []]));
  const resultCounts: Record<number, number> = Object.fromEntries(requestedBuckets.map((day) => [day, 0]));
  let retainedResults = 0;
  let scheduleId = 0;

  const considerCandidate = (sections: Section[], metrics: NonNullable<ReturnType<typeof calculateMetrics>>) => {
    if (metrics.numDays < 1 || !requestedBuckets.includes(metrics.numDays)) return;
    const candidate: OptimizationResult = {
      id: `sch-${++scheduleId}`,
      sections: [...sections],
      days: metrics.days,
      numDays: metrics.numDays,
      totalGap: metrics.totalGap,
      totalCredits: metrics.totalCredits,
      creditsComplete: sections.every((section) => Number.isFinite(section.credits ?? NaN)) && sections.every((section) => !(Array.isArray(section.creditHoursConflict) && section.creditHoursConflict.length > 1)),
      earliestStartMinutes: metrics.earliestStartMinutes,
      latestEndMinutes: metrics.latestEndMinutes,
    };
    resultCounts[metrics.numDays] += 1;
    const bucket = topByDay[metrics.numDays] || [];
    const beforeLength = bucket.length;
    insertTopResult(bucket, candidate, preferences);
    topByDay[metrics.numDays] = bucket;
    if (bucket.length > beforeLength) retainedResults += 1;
    if (retainedResults > control.budget.maxResultsRetained) {
      control.capped = true;
    }
  };

  const processSubset = (subset: string[]) => {
    if (stopRequested(control)) return;
    output.searchStats!.candidateCourseSubsets += 1;
    const sectionLists = subset.map((subject) => validCourses[subject] || []);
    if (sectionLists.some((list) => list.length === 0)) return;
    const currentState = createEmptySearchState();
    for (const fixedSection of fixed) {
      const normalized = normalizeSection(fixedSection);
      if (!normalized) return;
      addNormalizedSection(currentState, normalized);
    }
    enumerateSectionCombinations(
      sectionLists,
      control,
      (section, chosen) => {
        const normalized = normalizeSection(section);
        if (!normalized) return null;
        if (chosen.some((item) => (item.courseKey || getCourseIdentityKey(item.courseCode, item.name)) === normalized.section.courseKey)) return null;
        if (!canAddSectionEarly(normalized, currentState, preferences, fixed.length, chosen.length, targetCredits, maxRange)) return null;
        if (conflictsWithChosen(normalized.section, fixed, chosen)) return null;
        addNormalizedSection(currentState, normalized);
        return () => removeNormalizedSection(currentState, normalized);
      },
      (chosen) => {
        output.totalCombinationsEvaluated += 1;
        output.searchStats!.schedulesEvaluated += 1;
        const metrics = stateToMetrics(currentState);
        if (!scheduleMatchesHardPreferences(chosen, preferences, metrics)) return;
        if (targetCredits != null && Math.abs(metrics.totalCredits - targetCredits) > EPSILON) return;
        if (minRange != null && metrics.totalCredits < minRange - EPSILON) return;
        if (maxRange != null && metrics.totalCredits > maxRange + EPSILON) return;
        const verified = calculateMetrics(chosen);
        if (!verified || Math.abs(verified.totalCredits - metrics.totalCredits) > EPSILON) return;
        considerCandidate(chosen, verified);
      },
    );
  };

  const subsetSubjects = candidateForSearch.filter((key) => !fixedKeys.has(key));
  // Use the shared course-subset traversal. Exact credit matching and exact course
  // count are both applied before section combinations are visited.
  const exactTargetCredits = targetCredits != null ? targetCredits - fixedCredits : null;
  const mandatoryCreditMap = new Map(creditsByCourse);
  enumerateCourseSubsets(
    subsetSubjects,
    mandatorySubjects,
    targetCourseCount,
    exactTargetCredits,
    mandatoryCreditMap,
    processSubset,
    control,
    fixed.length,
  );


  if (control.cancelled) output.searchCompleteness = 'cancelled';
  else if (control.capped) output.searchCompleteness = 'capped';
  output.wasCapped = control.capped;

  const allRetained = requestedBuckets.flatMap((day) => topByDay[day] || []);
  allRetained.sort((a, b) => compareSchedulesDeterministically(a, b, preferences));
  const globalRankMap = new Map<string, number>();
  allRetained.forEach((schedule, index) => {
    globalRankMap.set(schedule.id, index + 1);
    schedule.globalRank = index + 1;
    schedule.scheduleSignature = schedule.scheduleSignature || getScheduleSignature(schedule);
  });
  for (const dayCount of requestedBuckets) {
    const bucket = topByDay[dayCount] || [];
    output.byDayCount[dayCount] = finaliseTies(bucket, preferences, globalRankMap);
    output.totalFoundByDay[dayCount] = resultCounts[dayCount] || 0;
  }
  output.searchStats!.schedulesReturned = requestedBuckets.reduce((sum, day) => sum + (output.byDayCount[day] || []).length, 0);
  output.searchStats!.courseSubsetNodes = control.courseSubsetNodes;
  output.searchStats!.sectionNodes = control.sectionNodes;

  if (Object.values(output.totalFoundByDay).every((count) => count === 0) && output.searchCompleteness === 'exhaustive') {
    let reason = 'No conflict-free schedule could be built from the available sections.';
    if (targetCourseCount && targetCredits && targetCredits > 0) reason = `No valid schedule matches exactly ${targetCourseCount} course(s) and ${targetCredits} credits with the available course sections.`;
    else if (targetCredits && targetCredits > 0) reason = `No valid schedule matches exactly ${targetCredits} credits with the available course sections.`;
    else if (targetCourseCount && targetCourseCount > 0) reason = `No valid schedule matches exactly ${targetCourseCount} course(s) with the available sections.`;
    output.impossibleDiagnostic = {
      reason,
      suggestion: 'Try one of the specific relaxations below, then build again.',
    };

    if (mode !== 'diagnostic' && output.searchCompleteness === 'exhaustive') {
      const relaxationResults: NonNullable<NonNullable<OptimizerOutput['impossibleDiagnostic']>['secondaryDiagnostics']> = [];
      let relaxedPreferences = { ...preferences };
      for (const relaxation of diagnosticRelaxations(preferences)) {
        relaxedPreferences = { ...relaxedPreferences, ...relaxation.update };
        const relaxedOutput = runOptimizer({
          courses,
          fixedCourses: fixed,
          preferences: relaxedPreferences,
          shouldCancel,
          mode: 'diagnostic',
          searchBudget: DIAGNOSTIC_SEARCH_BUDGET,
        });
        const count = Object.values(relaxedOutput.totalFoundByDay || {}).reduce((sum, value) => sum + value, 0);
        if (count > 0) {
          relaxationResults.push({
            reason: `Schedules appear when you ${relaxation.label.toLowerCase()}.`,
            suggestion: relaxation.label,
            actionType: actionTypeForDiagnostic(relaxation.key),
            actionLabel: relaxation.label,
            countIfRelaxed: count,
          });
        }
        if (relaxationResults.length >= 3) break;
      }
      output.impossibleDiagnostic.secondaryDiagnostics = relaxationResults;
      output.secondaryDiagnostics = relaxationResults;
    }
  }

  output.diagnostics = requestedBuckets
    .filter((day) => (output.byDayCount[day] || []).length === 0)
    .map((day) => output.searchCompleteness === 'exhaustive'
      ? `No valid schedule exists for ${day} campus days.`
      : `No qualifying schedule was found for ${day} campus days within the completed search.`);

  const durationMs = perfTimer();
  recordPerformanceMetric('optimizer', durationMs, {
    combinations: output.totalCombinationsEvaluated,
    results: output.searchStats?.schedulesReturned || 0,
    completeness: output.searchCompleteness,
  });
  return output;
}
