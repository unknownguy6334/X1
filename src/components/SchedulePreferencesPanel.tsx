import React from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import type { DayOfWeek, SchedulePreferences } from '../types';
import type { GroupedCourse } from '../utils/courseUtils';
import { ALL_DAYS } from '../utils/optimizer';
import { CREDIT_PRECISION_STEP, TARGET_CREDITS_MAX, TARGET_CREDITS_MIN, isValidTargetCredits } from '../utils/preferenceValidation';

interface PreferenceValidationState {
  isValid: boolean;
  error?: string;
}

export interface SchedulePreferencesPanelProps {
  preferences: SchedulePreferences;
  onUpdatePreferences: (prefs: SchedulePreferences) => void;
  savedCourseGroups: GroupedCourse[];
  targetCreditsStr: string;
  setTargetCreditsStr: React.Dispatch<React.SetStateAction<string>>;
  targetCourseCountStr: string;
  setTargetCourseCountStr: React.Dispatch<React.SetStateAction<string>>;
  markUserSetTargetCourseCount: () => void;
  markUserSetTargetCredits: () => void;
  minCreditsStr: string;
  maxCreditsStr: string;
  targetCreditsValidation: PreferenceValidationState;
  targetCourseCountValidation: PreferenceValidationState;
  creditRangeValidation: PreferenceValidationState;
  timeWindowValidation: PreferenceValidationState;
  unknownCreditCourseCount: number;
  mandatoryCourseKeys: string[];
  mandatoryCourses: string[];
  isGroupMandatory: (group: GroupedCourse) => boolean;
  handleToggleMandatoryCourse: (group: GroupedCourse) => void;
  handleClearAllMandatory: () => void;
  handleToggleDayBucket: (dayCount: number) => void;
  handleTimePreferenceChange: (field: 'earliestStartTime' | 'latestEndTime', value: string) => void;
  handleCreditRangeToggle: (enabled: boolean) => void;
  handleCreditRangeValue: (field: 'minCredits' | 'maxCredits', value: string) => void;
  handleToggleFreeDay: (day: DayOfWeek) => void;
  handleResetTimingPreferences: () => void;
  hasAnyTimingPrefs: boolean;
  formatCourseDisplay: (courseCode?: string | null, courseName?: string | null) => string;
  dayLabels: Record<DayOfWeek, string>;
  onOpenTips: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const SchedulePreferencesPanel = React.memo(function SchedulePreferencesPanel({
  preferences,
  onUpdatePreferences,
  savedCourseGroups,
  targetCreditsStr,
  setTargetCreditsStr,
  targetCourseCountStr,
  setTargetCourseCountStr,
  markUserSetTargetCourseCount,
  markUserSetTargetCredits,
  minCreditsStr,
  maxCreditsStr,
  targetCreditsValidation,
  targetCourseCountValidation,
  creditRangeValidation,
  timeWindowValidation,
  unknownCreditCourseCount,
  mandatoryCourseKeys,
  mandatoryCourses,
  isGroupMandatory,
  handleToggleMandatoryCourse,
  handleClearAllMandatory,
  handleToggleDayBucket,
  handleTimePreferenceChange,
  handleCreditRangeToggle,
  handleCreditRangeValue,
  handleToggleFreeDay,
  handleResetTimingPreferences,
  hasAnyTimingPrefs,
  formatCourseDisplay,
  dayLabels,
  onOpenTips,
}: SchedulePreferencesPanelProps) {
  const dayBuckets = preferences.dayBuckets?.length ? preferences.dayBuckets : [1,2,3,4,5,6,7];

  return (
    <section className="responsive-fit-card" aria-labelledby="responsive-fit-title">
      <div className="responsive-fit-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="responsive-step-label">2 · BUILD YOUR WEEK</span>
            <h2 id="responsive-fit-title">Choose the courses you want.</h2>
            <p>Gadwal checks the possible combinations and puts schedules with less gap time first.</p>
          </div>
          <button type="button" onClick={onOpenTips} className="responsive-info-pill shrink-0" title="How preferences work" aria-label="Open preference tips">
            <HelpCircle className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <span>Preference tips</span>
          </button>
        </div>
      </div>

      <div className="responsive-customize-stack">
        <div className="responsive-preference-row">
          <div><strong>How many credits do you want?</strong></div>
          <input
            type="number" min={TARGET_CREDITS_MIN} max={TARGET_CREDITS_MAX} step={CREDIT_PRECISION_STEP} inputMode="decimal"
            value={targetCreditsStr}
            onChange={(e) => {
              markUserSetTargetCredits();
              const val = e.target.value;
              setTargetCreditsStr(val);
              const trimmed = val.trim();
              if (!trimmed) { onUpdatePreferences({ ...preferences, targetCredits: null }); return; }
              const parsed = Number(trimmed);
              if (isValidTargetCredits(parsed)) onUpdatePreferences({ ...preferences, targetCredits: parsed });
            }}
            placeholder="e.g. 15" className="w-28 min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm font-bold text-ink font-mono text-center focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="How many credits do you want?" aria-invalid={!targetCreditsValidation.isValid} aria-describedby={!targetCreditsValidation.isValid ? 'target-credits-error' : undefined}
          />
        </div>

        <div className="responsive-preference-row">
          <div><strong>How many courses do you want?</strong></div>
          <input
            type="number" min="1" max={Math.max(1, savedCourseGroups.length)} step="1" inputMode="numeric"
            value={targetCourseCountStr}
            onChange={(e) => {
              markUserSetTargetCourseCount();
              const val = e.target.value;
              setTargetCourseCountStr(val);
              const parsed = parseInt(val.trim(), 10);
              onUpdatePreferences({ ...preferences, targetCourseCount: Number.isNaN(parsed) || val.trim() === '' ? null : parsed });
            }}
            placeholder={savedCourseGroups.length > 0 ? `e.g. ${Math.min(5, savedCourseGroups.length)}` : 'e.g. 5'}
            className="w-28 min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm font-bold text-ink font-mono text-center focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="How many courses do you want?" aria-invalid={!targetCourseCountValidation.isValid} aria-describedby={!targetCourseCountValidation.isValid ? 'target-course-count-error' : undefined}
          />
        </div>

        {!targetCreditsValidation.isValid && targetCreditsValidation.error && <p id="target-credits-error" className="text-sm text-alert font-semibold px-1" role="alert">{targetCreditsValidation.error}</p>}
        {!targetCourseCountValidation.isValid && targetCourseCountValidation.error && <p id="target-course-count-error" className="text-sm text-alert font-semibold px-1" role="alert">{targetCourseCountValidation.error}</p>}
        {!creditRangeValidation.isValid && creditRangeValidation.error && <p id="credit-range-error" className="text-sm text-alert font-semibold px-1" role="alert">{creditRangeValidation.error}</p>}
        {!timeWindowValidation.isValid && timeWindowValidation.error && <p id="time-window-error" className="text-sm text-alert font-semibold px-1" role="alert">{timeWindowValidation.error}</p>}
        <p className="text-xs text-text-secondary px-1">If you set both, Gadwal matches both your credit target and course count.</p>
        {unknownCreditCourseCount > 0 && <p className="text-xs text-amber-700 font-semibold px-1">{unknownCreditCourseCount} course{unknownCreditCourseCount === 1 ? '' : 's'} have unknown credits, so the available-credit total is incomplete.</p>}

        <details className="responsive-details-drawer">
          <summary className="text-ink font-bold text-base flex items-center justify-between cursor-pointer"><span>Schedule preferences</span><ChevronDown className="w-4 h-4 text-text-muted" aria-hidden="true" /></summary>
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-sm font-bold text-ink mb-2">Preferred campus days</p>
              <div className="responsive-chip-grid">
                {[1,2,3,4,5,6,7].map((d) => { const active = dayBuckets.includes(d); return <button key={d} type="button" onClick={() => handleToggleDayBucket(d)} className={active ? 'responsive-chip active' : 'responsive-chip'} aria-pressed={active}>{d} {d === 1 ? 'day' : 'days'}</button>; })}
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-ink mb-2">Time window</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label htmlFor="preference-earliest-start" className="text-sm font-semibold text-text-secondary">Earliest start<input id="preference-earliest-start" type="time" value={preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' ? preferences.earliestStartTime : ''} onChange={(e) => handleTimePreferenceChange('earliestStartTime', e.target.value)} className="mt-1 w-full min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm text-ink" aria-invalid={!timeWindowValidation.isValid} aria-describedby={!timeWindowValidation.isValid ? 'time-window-error' : undefined} /></label>
                <label htmlFor="preference-latest-end" className="text-sm font-semibold text-text-secondary">Latest end<input id="preference-latest-end" type="time" value={preferences.latestEndTime && preferences.latestEndTime !== 'ANY' ? preferences.latestEndTime : ''} onChange={(e) => handleTimePreferenceChange('latestEndTime', e.target.value)} className="mt-1 w-full min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm text-ink" aria-invalid={!timeWindowValidation.isValid} aria-describedby={!timeWindowValidation.isValid ? 'time-window-error' : undefined} /></label>
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-ink mb-2">Days you want free</p>
              <div className="responsive-chip-grid">
                {ALL_DAYS.map((day) => { const active = (preferences.freeDays || []).includes(day); return <button key={day} type="button" onClick={() => handleToggleFreeDay(day)} className={active ? 'responsive-chip active' : 'responsive-chip'} aria-pressed={active}>{dayLabels[day]}</button>; })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label htmlFor="preference-max-days" className="text-sm font-semibold text-text-secondary">Maximum campus days<select id="preference-max-days" value={preferences.maxDays ?? ''} onChange={(e) => onUpdatePreferences({ ...preferences, maxDays: e.target.value ? Number(e.target.value) : null })} className="mt-1 w-full min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm text-ink"><option value="">No maximum</option>{[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}</select></label>
              <label className="flex items-center gap-2 min-h-[44px] text-sm font-semibold text-ink"><input type="checkbox" checked={Boolean(preferences.preferCompactDays)} onChange={(e) => onUpdatePreferences({ ...preferences, preferCompactDays: e.target.checked })} /> Prefer compact days</label>
            </div>
            <div className="border-t border-line pt-3">
              <label className="flex items-center gap-2 text-sm font-bold text-ink"><input type="checkbox" checked={Boolean(preferences.useCreditRange)} onChange={(e) => handleCreditRangeToggle(e.target.checked)} /> Also enforce a credit range</label>
              {preferences.useCreditRange && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <label htmlFor="preference-min-credits" className="text-sm font-semibold text-text-secondary">Minimum credits<input id="preference-min-credits" type="number" min="0" max={TARGET_CREDITS_MAX} step={CREDIT_PRECISION_STEP} inputMode="decimal" value={minCreditsStr} onChange={(e) => handleCreditRangeValue('minCredits', e.target.value)} className="mt-1 w-full min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm text-ink" aria-invalid={!creditRangeValidation.isValid} aria-describedby={!creditRangeValidation.isValid ? 'credit-range-error' : undefined} /></label>
                <label htmlFor="preference-max-credits" className="text-sm font-semibold text-text-secondary">Maximum credits<input id="preference-max-credits" type="number" min="0" max={TARGET_CREDITS_MAX} step={CREDIT_PRECISION_STEP} inputMode="decimal" value={maxCreditsStr} onChange={(e) => handleCreditRangeValue('maxCredits', e.target.value)} className="mt-1 w-full min-h-[44px] px-3 py-2 bg-white border border-line-strong rounded-sm text-sm text-ink" aria-invalid={!creditRangeValidation.isValid} aria-describedby={!creditRangeValidation.isValid ? 'credit-range-error' : undefined} /></label>
              </div>}
            </div>
            {hasAnyTimingPrefs && <button type="button" className="responsive-link-button" onClick={handleResetTimingPreferences}>Reset schedule preferences</button>}
          </div>
        </details>

        {savedCourseGroups.length > 0 && <details className="responsive-details-drawer" open>
          <summary className="text-ink font-bold text-base flex items-center justify-between cursor-pointer"><span>Courses you must take</span><ChevronDown className="w-4 h-4 text-text-muted transition-transform duration-200 details-chevron" aria-hidden="true" /></summary>
          <p className="mt-1 mb-3 text-sm font-bold text-ink leading-normal">Courses that you want to take no matter what. Gadwal will include these courses in every schedule it creates.</p>
          <div className="responsive-chip-grid">
            {savedCourseGroups.map((group) => { const checked = isGroupMandatory(group); return <button key={group.courseKey || `${group.courseCode || ''}:${group.courseName}`} type="button" onClick={() => handleToggleMandatoryCourse(group)} className={checked ? 'responsive-chip active' : 'responsive-chip'} aria-pressed={checked}>{formatCourseDisplay(group.courseCode, group.courseName)}</button>; })}
          </div>
          {mandatoryCourses.length > 0 && <button type="button" className="responsive-link-button" onClick={handleClearAllMandatory}>Clear must-take courses</button>}
          <span className="sr-only">{mandatoryCourseKeys.length} courses currently marked must-take.</span>
        </details>}
      </div>
    </section>
  );
});
