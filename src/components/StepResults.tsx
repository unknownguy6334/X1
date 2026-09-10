import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Info, X } from 'lucide-react';
import { COPY } from '../content/copy';
import { OptimizationResult, OptimizerOutput, DayOfWeek, SchedulePreferences, Section } from '../types';
import { compareSchedulesDeterministically } from '../utils/optimizer';
import { formatTo12Hour } from '../utils/parser';
import { groupSectionsByCourse, formatCourseDisplay, getScheduleSignature } from '../utils/courseUtils';
import { formatGapTime, getCourseCreditSummary, getRankingSummary, getScheduleTheme, getSortedScheduleDaySessions, RESULT_DAY_FULL_NAMES, RESULT_DAY_ORDER } from '../utils/resultsPresentation';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { safeStorage } from '../utils/safeStorage';

interface StepResultsProps {
  optimizerOutput: OptimizerOutput;
  preferences: SchedulePreferences;
  sections: Section[];
  onBackToSetup: () => void;
  onAutoFixPreference?: (updatedPref: Partial<SchedulePreferences>) => void;
  isStale?: boolean;
  staleChangeSummary?: {
    reasons: string[];
    deletedCourseNames: string[];
    modifiedCourseNames: string[];
    addedCourseNames: string[];
    hasStructuralCourseChange: boolean;
    hasPreferenceChange: boolean;
  };
  onRecomputeSchedules?: () => void;
  onCancelOptimizer?: () => void;
  isCalculating?: boolean;
}

type DayFilter = 'all' | 1 | 2 | 3 | 4 | 5 | 6 | 7;
const ScheduleExportMenu = lazy(() => import('./ScheduleExportMenu').then((m) => ({ default: m.ScheduleExportMenu })));
const DAY_NAMES: Record<DayOfWeek,string> = RESULT_DAY_FULL_NAMES;
const DAY_VALUES: DayFilter[] = ['all', 1, 2, 3, 4, 5, 6, 7];

const COURSE_PALETTES = [
  { border: 'border-l-blue-500', bg: 'bg-blue-50/60', dot: 'bg-blue-500', text: 'text-blue-950' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-50/60', dot: 'bg-emerald-500', text: 'text-emerald-950' },
  { border: 'border-l-amber-500', bg: 'bg-amber-50/60', dot: 'bg-amber-500', text: 'text-amber-950' },
  { border: 'border-l-purple-500', bg: 'bg-purple-50/60', dot: 'bg-purple-500', text: 'text-purple-950' },
  { border: 'border-l-rose-500', bg: 'bg-rose-50/60', dot: 'bg-rose-500', text: 'text-rose-950' },
  { border: 'border-l-teal-500', bg: 'bg-teal-50/60', dot: 'bg-teal-500', text: 'text-teal-950' },
  { border: 'border-l-indigo-500', bg: 'bg-indigo-50/60', dot: 'bg-indigo-500', text: 'text-indigo-950' },
  { border: 'border-l-orange-500', bg: 'bg-orange-50/60', dot: 'bg-orange-500', text: 'text-orange-950' },
];
function getCourseColor(identity: string) {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) { hash = (hash << 5) - hash + identity.charCodeAt(i); hash |= 0; }
  return COURSE_PALETTES[Math.abs(hash) % COURSE_PALETTES.length];
}

export const StepResults: React.FC<StepResultsProps> = ({
  optimizerOutput,
  preferences,
  sections,
  onBackToSetup,
  onAutoFixPreference,
  isStale = false,
  staleChangeSummary,
  onRecomputeSchedules,
  onCancelOptimizer,
  isCalculating = false,
}) => {
  const filterStorageKey = `gadwal_results_filter_v2:${optimizerOutput.workflowGenerationId || optimizerOutput.generatedInputsSignature || 'current'}`;
  const [selectedDayFilter, setSelectedDayFilter] = useState<DayFilter>(() => {
    const saved = safeStorage.getItem(filterStorageKey);
    return saved === 'all' || ['1','2','3','4','5','6','7'].includes(String(saved)) ? (saved === 'all' ? 'all' : Number(saved) as DayFilter) : 'all';
  });
  const [expandedSchedules, setExpandedSchedules] = useState<Record<string, boolean>>({});
  const [isRankInfoOpen, setIsRankInfoOpen] = useState(false);
  const rankingModalRef = useModalAccessibility<HTMLDivElement>({ isOpen: isRankInfoOpen, onClose: () => setIsRankInfoOpen(false) });

  const generatedPreferences = optimizerOutput.preferencesUsed;
  const generatedSections = optimizerOutput.sectionsSnapshotComplete === false || !Array.isArray(optimizerOutput.sectionsSnapshot) ? [] : optimizerOutput.sectionsSnapshot;
  const generatedGroups = useMemo(() => groupSectionsByCourse(generatedSections), [generatedSections]);
  const currentGroups = useMemo(() => groupSectionsByCourse(sections), [sections]);
  const generatedCreditSummary = useMemo(() => getCourseCreditSummary(generatedSections), [generatedSections]);
  const currentCreditSummary = useMemo(() => getCourseCreditSummary(sections), [sections]);

  const completeness = optimizerOutput.searchCompleteness || 'not_searched';
  const isPartial = completeness !== 'exhaustive';
  const generatedTitle = completeness === 'exhaustive' ? 'Here are your best schedule options.' : completeness === 'cancelled' ? 'Search stopped before the full result set was verified.' : 'Here are the best schedules found so far.';

  useEffect(() => {
    safeStorage.setItem(filterStorageKey, String(selectedDayFilter));
  }, [filterStorageKey, selectedDayFilter]);

  const rankedByDay = useMemo(() => {
    const result: Record<number, OptimizationResult[]> = {};
    for (const d of [1,2,3,4,5,6,7]) result[d] = [...(optimizerOutput.byDayCount[d] || [])].sort((a,b) => generatedPreferences ? compareSchedulesDeterministically(a,b,generatedPreferences) : ((a.globalRank ?? 9999) - (b.globalRank ?? 9999)));
    return result;
  }, [optimizerOutput, generatedPreferences]);

  const allRankedSchedules = useMemo(() => {
    const seen = new Set<string>();
    const indexes = new Map<number, number>();
    const out: OptimizationResult[] = [];
    for (const d of [1,2,3,4,5,6,7]) indexes.set(d, 0);
    while (out.length < 5) {
      let best: OptimizationResult | null = null;
      let bestDay: number | null = null;
      for (const d of [1,2,3,4,5,6,7]) {
        const i = indexes.get(d) || 0;
        const candidate = rankedByDay[d]?.[i];
        const signature = candidate?.scheduleSignature || (candidate ? getScheduleSignature(candidate) : '');
        if (!candidate || !signature || seen.has(signature)) continue;
        if (!best || (candidate.globalRank ?? 999999) < (best.globalRank ?? 999999)) { best = candidate; bestDay = d; }
      }
      if (!best || bestDay == null) break;
      seen.add(best.scheduleSignature || getScheduleSignature(best)); out.push(best); indexes.set(bestDay, (indexes.get(bestDay) || 0) + 1);
    }
    return out;
  }, [rankedByDay, generatedPreferences]);

  const totalFoundByDay = useMemo(() => {
    const result: Record<number,number> = {};
    for (const d of [1,2,3,4,5,6,7]) result[d] = optimizerOutput.totalFoundByDay?.[d] ?? (optimizerOutput.byDayCount[d] || []).length;
    return result;
  }, [optimizerOutput]);
  const totalFoundAll = Object.values(totalFoundByDay).reduce((sum,n) => sum+n, 0);

  useEffect(() => {
    if (isStale || selectedDayFilter === 'all') return;
    if ((totalFoundByDay[selectedDayFilter] || 0) > 0) return;
    const firstPopulated = ([1,2,3,4,5,6,7] as const).find((d) => (totalFoundByDay[d] || 0) > 0);
    setSelectedDayFilter(firstPopulated ?? 'all');
  }, [optimizerOutput.generatedAt, optimizerOutput.totalFoundByDay, selectedDayFilter, totalFoundByDay, isStale]);

  const activeSchedules = useMemo(() => {
    if (isStale) return [];
    return selectedDayFilter === 'all' ? allRankedSchedules : (rankedByDay[selectedDayFilter] || []);
  }, [allRankedSchedules, rankedByDay, selectedDayFilter, isStale]);
  const displayedSchedules = activeSchedules.slice(0, 5);
  const dayFilterButtons = [{key:'all' as const,label:'Best',count:totalFoundAll}, ...([1,2,3,4,5,6,7] as const).map((d)=>({key:d,label:`${d} ${d===1?'day':'days'}`,count:totalFoundByDay[d]||0}))];
  const globalRankMap = useMemo(() => Object.fromEntries(allRankedSchedules.map((s,i)=>[s.id,s.globalRank ?? i+1])), [allRankedSchedules]);
  const categoryRankMap = useMemo(() => Object.fromEntries(([1,2,3,4,5,6,7] as const).flatMap((d) => (rankedByDay[d] || []).slice(0,5).map((s,i)=>[s.id,i+1]))), [rankedByDay]);

  const toggleDetails = (id:string) => setExpandedSchedules((prev)=>({...prev,[id]:!prev[id]}));
  const filterCount = selectedDayFilter === 'all' ? totalFoundAll : (totalFoundByDay[selectedDayFilter] || 0);
  const activeScopeLabel = selectedDayFilter === 'all' ? 'Best' : `${selectedDayFilter}-day`;
  const staleCurrentMismatch = isStale && currentGroups.length !== generatedGroups.length;

  const relaxationItems = optimizerOutput.impossibleDiagnostic?.secondaryDiagnostics || optimizerOutput.secondaryDiagnostics || [];

  const responsiveResults = (
    <div className="responsive-results-shell" aria-label="Gadwal schedule results">
      {isStale && (
        <div className="mt-3 p-4 rounded-xl border border-red-300 bg-red-50 text-red-950" role="alert">
          <strong>These schedules are from an earlier search and are not verified against your current choices.</strong>
          <p className="mt-1 text-sm">{staleChangeSummary?.reasons?.[0] || 'Your courses or preferences changed after these schedules were built.'}</p>
          {staleCurrentMismatch && <p className="mt-1 text-sm font-semibold">Current catalog: {currentGroups.length} courses · {currentCreditSummary.knownCredits} known credits. Generated catalog: {generatedGroups.length} courses · {generatedCreditSummary.knownCredits} known credits.</p>}
          {onRecomputeSchedules && <button type="button" className="responsive-primary-button mt-3 min-h-[44px]" onClick={onRecomputeSchedules} disabled={isCalculating}>Recalculate schedules</button>}
        </div>
      )}
      <div className="responsive-results-head">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" className="responsive-text-action min-h-[44px]" onClick={onBackToSetup}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Change choices</button>
          <button type="button" onClick={() => setIsRankInfoOpen(true)} className="responsive-info-pill" title="Learn how schedules are ranked">
            <Info className="w-4 h-4 text-blue-600" /><span>How ranking works</span>
          </button>
        </div>
        <div className="mt-2">
          <h1>{generatedTitle}</h1>
          <p>{optimizerOutput.generatedAt ? `Built ${Math.max(0, Math.round((Date.now() - optimizerOutput.generatedAt) / 60000))} minute${Math.round((Date.now() - optimizerOutput.generatedAt) / 60000) === 1 ? '' : 's'} ago · ` : ''}Generated from {generatedGroups.length} course{generatedGroups.length===1?'':'s'} · {generatedCreditSummary.knownCredits} known credits{generatedCreditSummary.unknownCourses > 0 ? ` · ${generatedCreditSummary.unknownCourses} course${generatedCreditSummary.unknownCourses===1?'':'s'} need credit review` : ''}</p>
        </div>
        <div className="responsive-preference-summary" aria-label="Preferences used to build these schedules">
          <strong>Built using</strong>
          <span>{generatedPreferences ? (generatedPreferences.targetCredits != null ? `${generatedPreferences.targetCredits} credits` : 'Any credits') : 'Original preferences unavailable'}</span>
          <span>· {generatedPreferences ? (generatedPreferences.targetCourseCount != null ? `${generatedPreferences.targetCourseCount} courses` : 'Any course count') : 'Original course count unavailable'}</span>
          <span>· {generatedPreferences ? `${(generatedPreferences.mandatoryCourseKeys || []).length} must-take` : 'Must-take settings unavailable'}</span>
          {generatedPreferences?.dayBuckets?.length ? <span>· {generatedPreferences.dayBuckets.join(', ')} day buckets</span> : null}
          {generatedPreferences?.maxDays != null && <span>· max {generatedPreferences.maxDays} days</span>}
          {generatedPreferences?.freeDays?.length ? <span>· free: {generatedPreferences.freeDays.map((d) => DAY_NAMES[d]).join(', ')}</span> : null}
          {generatedPreferences?.earliestStartTime && generatedPreferences.earliestStartTime !== 'ANY' && <span>· from {generatedPreferences.earliestStartTime}</span>}
          {generatedPreferences?.latestEndTime && generatedPreferences.latestEndTime !== 'ANY' && <span>· until {generatedPreferences.latestEndTime}</span>}
          {generatedPreferences?.useCreditRange && (generatedPreferences.minCredits != null || generatedPreferences.maxCredits != null) && <span>· range {generatedPreferences.minCredits ?? 0}–{generatedPreferences.maxCredits ?? '∞'} credits</span>}
          {generatedPreferences?.preferCompactDays && <span>· compact days preferred</span>}
          {isStale && <span className="font-bold text-red-700">· Generated preferences shown</span>}
        </div>
      </div>
      {isPartial && (
        <div className="mt-3 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm" role="status">
          <strong>{completeness === 'capped' ? 'Search limit reached.' : 'Search stopped.'}</strong>
          <p className="mt-1">{COPY.completeness[completeness]}</p>
        </div>
      )}
      {isCalculating && (
        <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-mist" role="status">
          <span className="text-sm font-semibold text-ink">Finding your best schedules…</span>
          {onCancelOptimizer && <button type="button" className="responsive-secondary-button min-h-[44px]" onClick={onCancelOptimizer}>Cancel search</button>}
        </div>
      )}
      <div className="responsive-filter-strip"><label htmlFor="responsive-day-filter">Show</label><select id="responsive-day-filter" value={String(selectedDayFilter)} onChange={(e)=>setSelectedDayFilter(e.target.value==='all'?'all':Number(e.target.value) as DayFilter)}>{dayFilterButtons.map(item=><option key={String(item.key)} value={String(item.key)}>{item.label} · {item.count}</option>)}</select></div>

      {displayedSchedules.length === 0 ? (
        <div className={`responsive-empty-state ${isStale ? 'border-red-200 bg-red-50/40' : ''}`}>
          <h2>{isStale ? 'These results need to be recalculated.' : completeness === 'exhaustive' ? 'We couldn’t find a schedule that fits these choices.' : 'No qualifying schedule was found within the completed search.'}</h2>
          <p>{isStale ? 'The current course list or preferences changed after these schedules were generated.' : optimizerOutput.impossibleDiagnostic?.reason || (completeness === 'exhaustive' ? 'Try changing one of your choices, then build again.' : 'Run the search again or relax a constraint. A partial search cannot prove that no schedule exists.')}</p>
          {relaxationItems.length > 0 && !isStale && <div className="mt-5 space-y-2 text-left">{relaxationItems.map((item, i) => <button key={`${item.actionType || 'relax'}-${i}`} type="button" className="w-full text-left p-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 min-h-[44px]" onClick={() => { if (item.actionType === 'clear_time_limits') onAutoFixPreference?.({ earliestStartTime: 'ANY', latestEndTime: 'ANY' }); else if (item.actionType === 'clear_free_days') onAutoFixPreference?.({ freeDays: [] }); else if (item.actionType === 'allow_all_days') onAutoFixPreference?.({ dayBuckets: [1,2,3,4,5,6,7] }); else if (item.actionType === 'relax_max_days') onAutoFixPreference?.({ maxDays: null }); else if (item.actionType === 'auto_adjust_credits') onAutoFixPreference?.({ targetCredits: null, targetCourseCount: null, useCreditRange: false, minCredits: undefined, maxCredits: undefined }); }}><strong className="block text-sm text-red-900">{item.actionLabel || 'Relax a constraint'}</strong><span className="block mt-1 text-xs text-red-800">{item.suggestion || item.reason}</span>{item.countIfRelaxed != null && <span className="block mt-1 text-xs font-semibold text-red-900">{item.countIfRelaxed} schedule options found</span>}</button>)}</div>}
          <button type="button" className="responsive-primary-button responsive-wide-button mt-5" onClick={onRecomputeSchedules || onBackToSetup}>{onRecomputeSchedules ? 'Recalculate schedules' : 'Change choices'}</button>
        </div>
      ) : (
        <div className="responsive-schedule-list">
          {displayedSchedules.map((schedule, index)=>{
            const categoryRank=schedule.categoryRank || categoryRankMap[schedule.id] || index+1;
            const globalRank=schedule.globalRank || globalRankMap[schedule.id];
            const rank=selectedDayFilter === 'all' ? (globalRank || index+1) : categoryRank;
            const disclosureKey = schedule.scheduleSignature || scheduleCanonicalSignature(schedule);
            const open=!!expandedSchedules[disclosureKey];
            const isRank1 = rank === 1;
            const theme = getScheduleTheme(rank);
            const previous = displayedSchedules[index - 1];
            const gap=schedule.totalGap===0 ? 'Zero gap' : `Total gaps: ${formatGapTime(schedule.totalGap).hoursStr} ${formatGapTime(schedule.totalGap).minutesStr}`;
            const daySessions = getSortedScheduleDaySessions(schedule);
            const detailId = `schedule-details-${disclosureKey.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`;
            const rankSummary = generatedPreferences ? getRankingSummary(schedule, previous, generatedPreferences) : 'Ranking details are based on the saved result order.';
            return <article className={`responsive-schedule-card ${isRank1 ? 'responsive-schedule-card-best' : ''}`} key={schedule.id}>
              <div className="responsive-schedule-card-top">
                <div>
                  <span className={`responsive-schedule-rank ${isRank1 ? 'responsive-schedule-rank-1' : ''}`}>#{rank}</span>
                  <h2>Schedule {rank}{selectedDayFilter !== 'all' && globalRank != null ? <span className="ml-2 text-xs font-semibold text-text-muted">(Best #{globalRank})</span> : null}</h2>
                </div>
                <Suspense fallback={null}><ScheduleExportMenu schedule={schedule} rank={rank}/></Suspense>
              </div>
              <div className="responsive-schedule-highlight">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong className={`inline-flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1 rounded-md border ${schedule.totalGap === 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'}`}>
                    {schedule.totalGap === 0 && <span className="text-emerald-600 font-bold" aria-hidden="true">✓</span>}{gap}
                  </strong>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">{schedule.numDays} {schedule.numDays===1?'day':'days'}</span>
                  <span className="text-xs text-text-secondary">{schedule.totalCredits} credits · {schedule.sections.length} {schedule.sections.length===1?'course':'courses'}</span>
                </div>
                <p className="responsive-schedule-secondary mt-2 font-semibold">{rankSummary}</p>
                <p className="sr-only">Course colors are only visual grouping; course name, code, option, meeting type, day, and time are provided as text.</p>
                {schedule.isTie && <p className="mt-1 text-xs font-bold text-blue-800" role="status">Tie: {schedule.tieReason || 'same active ranking criteria'}</p>}
              </div>
              <div className="responsive-schedule-days">
                {RESULT_DAY_ORDER.map(day => {
                  const sessions = daySessions[day];
                  if (!sessions.length) return null;
                  return <div className="responsive-day-group" key={day}>
                    <div className="responsive-day-heading"><h3 className="text-sm sm:text-base font-bold text-ink">{DAY_NAMES[day]}</h3><span className="text-sm text-text-secondary">{sessions.length} meeting{sessions.length===1?'':'s'}</span></div>
                    <div className="responsive-timetable-track">
                      {sessions.map((item, i) => {
                        const sec = item.section; const session = item.session; const col = getCourseColor(`${item.section.courseKey || item.section.courseCode || ''}:${item.displayCourse}`);
                        const gapMinutes = item.gapBeforeMinutes;
                        const durationMinutes = Math.max(1, item.endMinutes - item.startMinutes);
                        const gapStyle = gapMinutes > 0 ? { '--gap-height': `${Math.min(112, Math.max(10, gapMinutes * 0.55))}px` } as React.CSSProperties : undefined;
                        const blockStyle = { '--session-height': `${Math.min(180, Math.max(76, 58 + durationMinutes * 0.35))}px` } as React.CSSProperties;
                        return <React.Fragment key={`${sec.courseKey || sec.id}-${session.id || `${session.start}-${session.end}`}-${i}`}>
                          {gapMinutes > 0 && <div className="responsive-gap-spacer" style={gapStyle} aria-label={`${gapMinutes} minute gap before ${item.displayCourse}`}><span>{gapMinutes} min gap</span></div>}
                          <div className={`responsive-class-row responsive-timetable-block border-l-4 ${col.border} ${col.bg}`} style={blockStyle}>
                            <span className="responsive-class-main">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${col.dot}`} aria-hidden="true" />
                              <span className="min-w-0"><strong className={col.text}>{item.displayCourse}</strong><span className="responsive-schedule-secondary block text-sm font-semibold text-text-secondary">Option: {sec.sectionCode || 'Not provided'} · {session.type === 'Custom' ? (session.customType || 'Custom') : (session.type || 'Lecture')}</span></span>
                            </span>
                            <span className="responsive-class-time"><span>{formatTo12Hour(session.start)} to {formatTo12Hour(session.end)}</span></span>
                          </div>
                        </React.Fragment>;
                      })}
                    </div>
                  </div>;
                })}
              </div>
              <div className="sr-only" aria-label={`Accessible schedule summary for Schedule ${rank}`}>
                <h3>{`Schedule ${rank} timetable`}</h3>
                <ul>
                  {RESULT_DAY_ORDER.flatMap(day => daySessions[day]).map((item, i) => (
                    <li key={`accessible-${schedule.id}-${i}`}>
                      {DAY_NAMES[item.session.day]}: {item.displayCourse}; course code {item.section.courseCode || 'missing'}; option {item.section.sectionCode || 'not provided'}; {formatTo12Hour(item.session.start)} to {formatTo12Hour(item.session.end)}; {item.session.type === 'Custom' ? (item.session.customType || 'Custom') : (item.session.type || 'Lecture')}.
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" className={`responsive-secondary-button responsive-wide-button min-h-[44px] ${theme.toggleBtn}`} aria-expanded={open} aria-controls={detailId} onClick={()=>toggleDetails(disclosureKey)}>{open?'Hide full details':'See full details'} {open?<ChevronUp className="w-4 h-4" aria-hidden="true"/>:<ChevronDown className="w-4 h-4" aria-hidden="true"/>}</button>
              <div id={detailId} hidden={!open} role="region" aria-labelledby={`${detailId}-title`} className="responsive-full-week-card border border-line p-3.5">
                <h3 id={`${detailId}-title`} className="text-sm sm:text-base font-bold text-ink">Full details for Schedule {rank}</h3>
                <ul className="mt-3 space-y-4 list-disc pl-5">
                  {schedule.sections.map((sec) => {
                    const sorted = RESULT_DAY_ORDER.flatMap(day => daySessions[day].filter(item => item.section.id === sec.id));
                    return <li key={`${sec.courseKey || sec.name}-${sec.id}`} className="text-sm text-ink">
                      <strong>{formatCourseDisplay(sec.courseCode, sec.name)}</strong>
                      <ul className="mt-2 space-y-1 list-[circle] pl-5 text-text-secondary">
                        <li>Course code: {sec.courseCode || 'Course code missing'}</li>
                        <li>Option: {sec.sectionCode || 'Not provided'}</li>
                        <li>Credits: {sec.credits == null ? 'Unknown' : sec.credits}</li>
                        {sec.creditHoursConflict && sec.creditHoursConflict.length > 1 && <li>Credits: conflicting source values: needs review</li>}
                        {sec.instructor && sec.instructor.trim() && sec.instructor.trim() !== 'TBA' && <li>Instructor: {sec.instructor.trim()}</li>}
                        {sorted.map((item, i) => <li key={item.session.id || `${item.session.day}-${item.session.start}-${item.session.end}-${i}`}>{DAY_NAMES[item.session.day]} · {formatTo12Hour(item.session.start)} to {formatTo12Hour(item.session.end)} · {item.session.type === 'Custom' ? (item.session.customType || 'Custom') : (item.session.type || 'Lecture')}</li>)}
                      </ul>
                    </li>;
                  })}
                </ul>
              </div>
            </article>;
          })}
          <div className="pt-6 pb-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-line mt-6">
            <button type="button" className="responsive-secondary-button responsive-wide-button sm:w-auto min-h-[44px]" onClick={onBackToSetup}><ArrowLeft className="w-4 h-4" aria-hidden="true" /><span>Change choices or add courses</span></button>
            <span className="text-xs text-text-secondary text-center sm:text-right">Showing {displayedSchedules.length} of {filterCount} found {activeScopeLabel.toLowerCase()} {filterCount === 1 ? 'option' : 'options'}</span>
          </div>
        </div>
      )}

      {isRankInfoOpen && (
        <div className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150" onClick={() => setIsRankInfoOpen(false)}>
          <div ref={rankingModalRef} role="dialog" aria-modal="true" aria-labelledby="ranking-info-title" tabIndex={-1} className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink" onClick={(e) => e.stopPropagation()}>
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700"><Info className="w-4 h-4" aria-hidden="true" /></div><div><h2 id="ranking-info-title" className="text-base sm:text-lg font-black text-ink">How schedule ranking works</h2><p className="text-xs text-text-secondary">The exact order used for generated schedules</p></div></div>
              <button type="button" onClick={() => setIsRankInfoOpen(false)} aria-label="Close ranking info" className="gd-modal-close"><X className="w-5 h-5 text-text-secondary" aria-hidden="true" /></button>
            </div>
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-xs sm:text-sm text-text-secondary leading-relaxed">
              <div className="p-3 bg-paper rounded-xl border border-line space-y-1"><strong className="text-ink font-bold block text-sm">1. Least total gap time</strong><p className="text-xs text-ink-soft">Schedules with less waiting time between classes rank higher. A zero-gap schedule comes first.</p></div>
              <div className="p-3 bg-paper rounded-xl border border-line space-y-1"><strong className="text-ink font-bold block text-sm">2. Fewer campus days</strong><p className="text-xs text-ink-soft">When total gap time is equal, schedules using fewer campus days rank higher.</p></div>
              {generatedPreferences?.preferCompactDays && <div className="p-3 bg-paper rounded-xl border border-line space-y-1"><strong className="text-ink font-bold block text-sm">3. More compact daily spans</strong><p className="text-xs text-ink-soft">Because compact days are enabled, equal-gap and equal-day schedules are ordered by their daily class span.</p></div>}
              <div className="p-3 bg-paper rounded-xl border border-line space-y-1"><strong className="text-ink font-bold block text-sm">No-conflict rule</strong><p className="text-xs text-ink-soft">Only schedules that pass the engine’s overlap checks are eligible for display.</p></div>
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 space-y-1"><strong className="text-blue-950 font-bold block text-sm">Ties</strong><p className="text-xs text-blue-900">Schedules with equal active ranking values are ties. A deterministic internal signature only chooses their display order; it does not change their ranking quality.</p></div>
            </div>
            <div className="gd-modal-footer gd-modal-action-row"><button type="button" onClick={() => setIsRankInfoOpen(false)} className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer">Got it</button></div>
          </div>
        </div>
      )}
    </div>
  );
  return <div className="responsive-results-shell-wrap">{responsiveResults}</div>;
};
