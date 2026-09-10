import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Camera,
  PlusCircle,
  Plus,
  Trash2,
  Copy,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  X,
  BookOpen,
  HelpCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Check,
  Layers,
  Zap,
  Sparkles,
  ShieldCheck,
  CheckSquare,
  Square,
  ListOrdered,
  RefreshCw,
  PenLine,
  Pencil,
  Info,
  RotateCcw,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { DayOfWeek, Section, Session as Meeting, SessionType as MeetingType, SchedulePreferences } from '../types';
import { ALL_DAYS, timeToMinutes } from '../utils/optimizer';
import { CREDIT_PRECISION_STEP, TARGET_CREDITS_MAX, TARGET_CREDITS_MIN, isValidTargetCredits } from '../utils/preferenceValidation';
import { runOptimizerAsyncCancellable } from '../utils/optimizerWorkerClient';
import { recordPerformanceMetric, startPerformanceTimer } from '../utils/performanceTelemetry';
import { parseCreditHours, sanitizeBoundedText } from '../utils/validation';
import {
  normalizeCourseName,
  getCourseIdentityKey,
  canonicalizeSectionIdentity,
  groupSectionsByCourse,
  buildOptimizerCourseMap,
  deduplicateParsedBatch,
  sanitizeCourseNameOnly,
  formatCourseDisplay,
} from '../utils/courseUtils';
import { isSupportedScheduleImage, optimizeImageForOCR } from '../utils/imageOptimizer';
import { fingerprintDistance, sha256File, visualFingerprint } from '../utils/imageFileAnalysis';
import type { CourseBuilderAction, CourseBuilderWorkflowState } from '../features/courseBuilder/workflow';
import type { AddSectionsResult } from '../features/courseBuilder/contracts';
import { isManualMeetingType } from '../domain/meeting';
import { validateSection } from '../domain/validation';
import { createGenerationId } from '../domain/workflow';
import { UploadedFileItem, ManualSessionRow as ManualMeetingRow, ManualFormState, createLocalId, createEmptySession as createEmptyMeeting, createEmptyManualForm, sanitizeRecoveredManualForm, sanitizePendingReviewSections, readLatestPersisted } from '../features/courseBuilder/model';
import { COPY } from '../content/copy';
import { formatTo12Hour, parseUserTypedTime } from '../utils/parser';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { ConfirmResetModal } from './ConfirmResetModal';
import { CreditHourSelector } from './CreditHourSelector';
import { safeStorage, createStorageEnvelope } from '../utils/safeStorage';
import { REVIEW_MEETING_TYPE_OPTIONS, MANUAL_MEETING_TYPE_OPTIONS, normalizeMeetingType } from '../utils/meetingTypes';
import { validateOcrApiResponse, parseApiErrorEnvelope } from '../utils/ocrApiContract';
import { WORKFLOW_DRAFT_KEYS, readPendingReview, readManualForms, savePendingReview, saveManualForms, clearPendingReview, clearManualForms } from '../app/workflowPersistence';
import { STORAGE_KEY_ACTIVE_TAB } from '../app/persistence';
import { WorkflowStatus } from './WorkflowStatus';
import { OCR_CLIENT_TIMEOUT_MS } from '../utils/ocrTimeout';
import { SchedulePreferencesPanel } from './SchedulePreferencesPanel';

export type WorkflowPanel = 'start' | 'screenshots' | 'manual' | 'preferences';

interface StepAddCoursesProps {
  sections: Section[];
  onAddSections: (newSections: Section[]) => AddSectionsResult;
  onDeleteCourse?: (courseName: string, courseKey?: string) => void;
  onDeleteSection?: (sectionId: string, courseName?: string, courseKey?: string) => boolean | void;
  onUpdateSection?: (originalId: string, updatedSection: Section, originalCourseName?: string, originalCourseKey?: string, originalSectionKey?: string) => boolean | void;
  onClearSections: () => void;
  preferences: SchedulePreferences;
  onUpdatePreferences: (prefs: SchedulePreferences) => void;
  onRunOptimizer: () => void;
  onCancelOptimizer?: () => void;
  onOpenHowItWorks?: () => void;
  onOpenDemo?: (trigger?: HTMLElement | null) => void;
  onGoHome?: () => void;
  isCalculating?: boolean;
  hasPreviousResults?: boolean;
  isResultsStale?: boolean;
  staleReasons?: string[];
  onViewPreviousResults?: () => void;
  isOnline?: boolean;
  ocrServiceAvailable?: boolean;
  wasOffline?: boolean;
  refreshConnectivity?: () => Promise<boolean>;
  workflowPanel?: WorkflowPanel;
  onWorkflowPanelChange?: (panel: WorkflowPanel) => void;
  workflow: CourseBuilderWorkflowState;
  resetVersion?: number;
  workflowGenerationId?: string;
  dispatchWorkflow: React.Dispatch<CourseBuilderAction>;
}

type TabType = 'screenshot' | 'manual';

const OCR_PREPARATION_CACHE = new Map<string, { data: string; mimeType: string; warning?: string }>();
const OCR_PREPARATION_CACHE_MAX = 30;

const REVIEW_REASON_LABELS: Record<string, string> = {
  section_code_missing: 'The screenshot did not clearly show a section code.',
  ambiguous_meeting_time: 'At least one meeting time needed AM/PM confirmation.',
  ambiguous_time: 'At least one time was ambiguous and needs confirmation.',
  incomplete_meeting: 'A meeting was only partly readable and was not added as a normal meeting.',
  day_missing_or_unrecognized: 'A meeting day could not be read confidently.',
  start_time_missing_or_unrecognized: 'A meeting start time could not be read confidently.',
  end_time_missing_or_unrecognized: 'A meeting end time could not be read confidently.',
  invalid_time_order: 'A meeting has an invalid start/end order.',
  conflicting_meeting: 'The screenshots contain conflicting meeting evidence.',
  multiple_same_day_and_type: 'The same meeting type appears more than once on the same day; the times do not overlap.',
  credit_conflict: 'Different screenshots reported different credit values.',
  course_name_conflict: 'Different screenshots reported different course names.',
  meeting_type_unrecognized: 'A meeting type was not recognized and needs review.',
  meeting_type_missing: 'A meeting type was not visible.',
  course_code_embedded_in_title: 'The course code was inferred from title text instead of an explicit code field.',
  course_code_embedded_title_uncorroborated: 'The code-like text in the course title was not corroborated by an explicit code field.',
  section_association_inferred: 'A missing section was associated with another section using indirect evidence.',
  related_codes_independent_schedules: 'Related section-code evidence has different schedules.',
  model_flagged_review: 'The OCR model flagged this section for review.',
};

const REVIEW_BLOCKING_CODES = new Set([
  'ambiguous_meeting_time','ambiguous_time','incomplete_meeting','day_missing_or_unrecognized',
  'start_time_missing_or_unrecognized','end_time_missing_or_unrecognized','invalid_time_order',
  'conflicting_meeting','credit_conflict','course_name_conflict','meeting_type_unrecognized',
  'meeting_type_missing','related_codes_independent_schedules',
]);

const REVIEW_ACKNOWLEDGEMENT_CODES = new Set([
  'section_code_missing','course_code_embedded_in_title','course_code_embedded_title_uncorroborated','section_association_inferred','model_flagged_review','multiple_same_day_and_type',
]);

function reviewReasonCode(reason: string): string {
  return String(reason).split(':', 1)[0];
}

function reviewReasonLabel(reason: string): string {
  const code = reviewReasonCode(reason);
  return REVIEW_REASON_LABELS[code] || reason.replace(/_/g, ' ');
}


export const StepAddCourses: React.FC<StepAddCoursesProps> = React.memo(({
  sections,
  onAddSections,
  onDeleteCourse,
  onDeleteSection,
  onUpdateSection,
  onClearSections,
  preferences,
  onUpdatePreferences,
  onRunOptimizer,
  onCancelOptimizer,
  onOpenHowItWorks,
  onOpenDemo,
  onGoHome,
  isCalculating = false,
  hasPreviousResults = false,
  isResultsStale = false,
  staleReasons = [],
  onViewPreviousResults,
  isOnline: sharedIsOnline,
  ocrServiceAvailable = true,
  wasOffline: sharedWasOffline = false,
  refreshConnectivity,
  workflowPanel,
  onWorkflowPanelChange,
  workflow,
  resetVersion = 0,
  workflowGenerationId = '',
  dispatchWorkflow,
}) => {

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    try {
      const saved = safeStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
      if (saved === 'screenshot' || saved === 'manual') {
        return saved;
      }
    } catch {}
    return 'screenshot';
  });

  // Sync activeTab to safeStorage
  useEffect(() => {
    try {
      safeStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTab);
    } catch {}
  }, [activeTab]);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [internalPanel, setInternalPanel] = useState<WorkflowPanel>(() => {
    if (workflowPanel) return workflowPanel;
    return sections.length > 0 ? 'preferences' : 'start';
  });

  const responsivePanel = workflowPanel ?? internalPanel;

  useEffect(() => {
    if (sections.length === 0) {
      setIsScreenshotTipsOpen(false);
      setIsManualTipsOpen(false);
      setIsPreferencesTipsOpen(false);
      setIsDetailsModalOpen(false);
      setIsReviewModalOpen(false);
      setIsAddedSuccessPopupOpen(false);
    }
  }, [sections.length]);

  useEffect(() => {
    if (workflowPanel !== undefined) {
      setInternalPanel(workflowPanel);
    }
  }, [workflowPanel]);

  const currentPanelRef = useRef<WorkflowPanel>(workflowPanel ?? internalPanel);
  useEffect(() => {
    currentPanelRef.current = workflowPanel ?? internalPanel;
  }, [workflowPanel, internalPanel]);

  const onWorkflowPanelChangeRef = useRef(onWorkflowPanelChange);
  useEffect(() => {
    onWorkflowPanelChangeRef.current = onWorkflowPanelChange;
  }, [onWorkflowPanelChange]);

  const setWorkflowPanel = useCallback((panelOrUpdater: WorkflowPanel | ((prev: WorkflowPanel) => WorkflowPanel)) => {
    const current = currentPanelRef.current;
    const next = typeof panelOrUpdater === 'function' ? panelOrUpdater(current) : panelOrUpdater;
    if (next !== currentPanelRef.current) {
      currentPanelRef.current = next;
      setInternalPanel(next);
      onWorkflowPanelChangeRef.current?.(next);
    }
  }, []);
  const [customizePreferences, setCustomizePreferences] = useState(false);
  const [responsiveManualOpenIndex, setResponsiveManualOpenIndex] = useState<number | null>(0);
  useEffect(() => {
    if (responsiveManualOpenIndex == null) return;
    const frame = window.requestAnimationFrame(() => {
      const editor = document.getElementById(`manual-form-editor-${manualForms[responsiveManualOpenIndex]?.id || ''}`);
      const heading = editor?.querySelector<HTMLElement>('[data-manual-editor-heading]');
      if (heading && window.matchMedia('(max-width: 767px)').matches) heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [responsiveManualOpenIndex]);

  const [collapsedCourses, setCollapsedCourses] = useState<Set<string>>(new Set());
  const [isScreenshotTipsOpen, setIsScreenshotTipsOpen] = useState(false);
  const [isManualTipsOpen, setIsManualTipsOpen] = useState(false);
  const [isPreferencesTipsOpen, setIsPreferencesTipsOpen] = useState(false);
  const [isKeyboardViewportOpen, setIsKeyboardViewportOpen] = useState(false);
  const screenshotTipsTriggerRef = useRef<HTMLElement | null>(null);
  const manualTipsTriggerRef = useRef<HTMLElement | null>(null);
  const preferencesTipsTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateVisualViewport = () => {
      const isNarrow = window.innerWidth <= 900;
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const keyboardOpen = isNarrow && keyboardInset > 120 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      document.documentElement.style.setProperty('--g-visual-bottom-inset', `${Math.round(keyboardInset)}px`);
      setIsKeyboardViewportOpen(keyboardOpen);
    };

    updateVisualViewport();
    viewport.addEventListener('resize', updateVisualViewport);
    viewport.addEventListener('scroll', updateVisualViewport);
    window.addEventListener('resize', updateVisualViewport);
    window.addEventListener('focusin', updateVisualViewport);
    window.addEventListener('focusout', updateVisualViewport);
    return () => {
      viewport.removeEventListener('resize', updateVisualViewport);
      viewport.removeEventListener('scroll', updateVisualViewport);
      window.removeEventListener('resize', updateVisualViewport);
      window.removeEventListener('focusin', updateVisualViewport);
      window.removeEventListener('focusout', updateVisualViewport);
      document.documentElement.style.removeProperty('--g-visual-bottom-inset');
    };
  }, []);


  // Group current saved sections by canonical course identity (course code first; name only as fallback)
  const savedCourseGroups = useMemo(() => {
    return groupSectionsByCourse(sections);
  }, [sections]);

  const totalCredits = useMemo(() => {
    return savedCourseGroups.reduce((acc, g) => acc + (g.credits || 0), 0);
  }, [savedCourseGroups]);


  // Target course count & Target credits inputs with robust validation (#11)
  const [targetCourseCountStr, setTargetCourseCountStr] = useState<string>(
    preferences.targetCourseCount !== null && preferences.targetCourseCount !== undefined
      ? String(preferences.targetCourseCount)
      : ''
  );
  const hasUserSetTargetCourseCountRef = useRef(false);
  const hasUserSetTargetCreditsRef = useRef(false);
  const [targetCreditsStr, setTargetCreditsStr] = useState<string>(
    preferences.targetCredits !== null && preferences.targetCredits !== undefined
      ? String(preferences.targetCredits)
      : ''
  );
  const [minCreditsStr, setMinCreditsStr] = useState<string>(preferences.minCredits != null ? String(preferences.minCredits) : '');
  const [maxCreditsStr, setMaxCreditsStr] = useState<string>(preferences.maxCredits != null ? String(preferences.maxCredits) : '');

  // Sync state if preferences change externally
  useEffect(() => {
    if (preferences.targetCredits == null) hasUserSetTargetCreditsRef.current = false;
  }, [preferences.targetCredits]);

  useEffect(() => {
    if (preferences.targetCourseCount !== null && preferences.targetCourseCount !== undefined) setTargetCourseCountStr(String(preferences.targetCourseCount));
    else if (!hasUserSetTargetCourseCountRef.current) setTargetCourseCountStr('');
  }, [preferences.targetCourseCount]);

  useEffect(() => {
    if (preferences.targetCredits !== null && preferences.targetCredits !== undefined) setTargetCreditsStr(String(preferences.targetCredits));
    else setTargetCreditsStr('');
  }, [preferences.targetCredits]);

  useEffect(() => {
    setMinCreditsStr(preferences.minCredits != null ? String(preferences.minCredits) : '');
    setMaxCreditsStr(preferences.maxCredits != null ? String(preferences.maxCredits) : '');
  }, [preferences.minCredits, preferences.maxCredits]);

  // Target course count validation
  const targetCourseCountValidation = useMemo(() => {
    const str = targetCourseCountStr.trim();
    if (!str) {
      return { isValid: true, error: null, value: null };
    }
    // Reject decimals and invalid format
    if (!/^-?\d+$/.test(str)) {
      if (str.includes('.')) {
        return {
          isValid: false,
          error: 'Choose a whole number of courses. Decimals don’t work here.',
          value: null,
        };
      }
      return {
        isValid: false,
        error: 'Enter a whole number of courses.',
        value: null,
      };
    }
    const parsed = parseInt(str, 10);
    if (parsed <= 0) {
      return {
        isValid: false,
        error: 'Choose at least 1 course.',
        value: null,
      };
    }
    const maxCourses = savedCourseGroups.length;
    if (maxCourses > 0 && parsed > maxCourses) {
      return {
        isValid: false,
        error: `You chose ${parsed} courses, but only ${maxCourses} have been added.`,
        value: null,
      };
    }
    const mandatoryKeys = new Set((preferences.mandatoryCourseKeys || []).map((k) => k.toLowerCase()));
    const mandatoryCount = savedCourseGroups.filter((g) => mandatoryKeys.has((g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase())).length;
    if (mandatoryCount > 0 && parsed < mandatoryCount) {
      return {
        isValid: false,
        error: `You need at least ${mandatoryCount} courses because those courses are marked as must take.`,
        value: null,
      };
    }
    return { isValid: true, error: null, value: parsed };
  }, [targetCourseCountStr, savedCourseGroups, preferences.mandatoryCourses, preferences.mandatoryCourseKeys]);

  // How many credits do you want? of all selected mandatory courses
  const mandatoryCredits = useMemo(() => {
    const mandatoryKeys = new Set((preferences.mandatoryCourseKeys || []).map((k) => k.toLowerCase()));
    return savedCourseGroups
      .filter((g) => mandatoryKeys.has((g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase()))
      .reduce((acc, g) => acc + (Number.isFinite(g.credits ?? NaN) ? Number(g.credits) : 0), 0);
  }, [savedCourseGroups, preferences.mandatoryCourseKeys]);

  // Target credits validation
  const knownCredits = useMemo(() => savedCourseGroups.reduce((sum, g) => sum + (Number.isFinite(g.credits ?? NaN) ? Number(g.credits) : 0), 0), [savedCourseGroups]);
  const unknownCreditCourseCount = useMemo(() => savedCourseGroups.filter((g) => !Number.isFinite(g.credits ?? NaN)).length, [savedCourseGroups]);
  const targetCreditsValidation = useMemo(() => {
    const str = targetCreditsStr.trim();
    if (!str) return { isValid: true, error: null, value: null };
    if (!/^\d+(\.\d+)?$/.test(str)) return { isValid: false, error: 'Enter a valid number of credits.', value: null };
    const parsed = Number(str);
    if (!isValidTargetCredits(parsed)) {
      if (parsed > TARGET_CREDITS_MAX) return { isValid: false, error: `Credits cannot be more than ${TARGET_CREDITS_MAX}.`, value: null };
      return { isValid: false, error: `Credits must be at least ${TARGET_CREDITS_MIN} and use ${CREDIT_PRECISION_STEP}-credit steps.`, value: null };
    }
    if (savedCourseGroups.length > 0 && unknownCreditCourseCount === 0 && parsed > knownCredits + 0.001) {
      return { isValid: false, error: `You chose ${parsed} credits, but only ${knownCredits} credits are available.`, value: null };
    }
    const mandatoryKnownCredits = mandatoryCredits;
    const mandatoryCourseCount = preferences.mandatoryCourseKeys?.length || 0;
    if (mandatoryCourseCount > 0 && mandatoryKnownCredits > 0 && parsed < mandatoryKnownCredits - 0.001) {
      return { isValid: false, error: `You need at least ${mandatoryKnownCredits} credits because of your must-take courses.`, value: null };
    }
    return { isValid: true, error: null, value: parsed };
  }, [targetCreditsStr, knownCredits, unknownCreditCourseCount, mandatoryCredits, mandatoryCourseKeys, savedCourseGroups]);

  const timeWindowValidation = useMemo(() => {
    const start = preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' ? timeToMinutes(preferences.earliestStartTime) : null;
    const end = preferences.latestEndTime && preferences.latestEndTime !== 'ANY' ? timeToMinutes(preferences.latestEndTime) : null;
    if (start !== null && !Number.isFinite(start)) return { isValid: false, error: 'Choose a valid earliest start time.' };
    if (end !== null && !Number.isFinite(end)) return { isValid: false, error: 'Choose a valid latest end time.' };
    if (start !== null && end !== null && start > end) return { isValid: false, error: 'Earliest start cannot be later than latest end.' };
    return { isValid: true, error: null };
  }, [preferences.earliestStartTime, preferences.latestEndTime]);

  const creditRangeValidation = useMemo(() => {
    if (!preferences.useCreditRange) return { isValid: true, error: null };
    const min = preferences.minCredits; const max = preferences.maxCredits;
    if (min == null && max == null) return { isValid: true, error: null };
    if ((min != null && (min < 0 || min > TARGET_CREDITS_MAX)) || (max != null && (max < 0 || max > TARGET_CREDITS_MAX))) return { isValid: false, error: `Credit range values must be between 0 and ${TARGET_CREDITS_MAX}.` };
    if (min != null && max != null && min > max) return { isValid: false, error: 'Minimum credits cannot be greater than maximum credits.' };
    return { isValid: true, error: null };
  }, [preferences.useCreditRange, preferences.minCredits, preferences.maxCredits]);

  const isPreferencesValid = targetCreditsValidation.isValid && targetCourseCountValidation.isValid && creditRangeValidation.isValid && timeWindowValidation.isValid;

  // Specific validation error string for mobile sticky bar feedback (Problem #5)
  const preferencesValidationError = useMemo(() => {
    if (!targetCourseCountValidation.isValid && targetCourseCountValidation.error) {
      return targetCourseCountValidation.error;
    }
    if (!targetCreditsValidation.isValid && targetCreditsValidation.error) {
      return targetCreditsValidation.error;
    }
    return null;
  }, [targetCourseCountValidation, targetCreditsValidation]);

  // Smooth scroll to preferences section when requested from sticky bar
  const scrollToPreferences = () => {
    const el = document.getElementById('setup-preferences-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Targets remain user-owned values. Catalog changes are surfaced through validation
  // instead of silently rewriting what the student entered.

  // Screenshot Upload constraints & state
  const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // aligned with the server aggregate OCR corpus ceiling
  const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;

  const STORAGE_KEY_PENDING_REVIEW = WORKFLOW_DRAFT_KEYS.pendingReview;
  const STORAGE_KEY_MANUAL_FORMS = WORKFLOW_DRAFT_KEYS.manualForms;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleTriggerFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current?.click();
    } else {
      const el = document.getElementById('schedule-screenshot-upload-input') as HTMLInputElement | null;
      if (el) el.click();
    }
  }, []);
  const ocrAbortControllerRef = useRef<AbortController | null>(null);
  const ocrItemControllersRef = useRef<Map<string, AbortController>>(new Map());
  const ocrBatchGenerationRef = useRef(0);
  const ocrProcessingRef = useRef(false);
  const filePreparationRef = useRef(false);
  const filePreparationGenerationRef = useRef(0);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const handleProcessScreenshotsRef = useRef<(filesOverride?: UploadedFileItem[]) => Promise<void>>(async () => {});

  // File objects and object URLs cannot survive a page reload. Persisting their metadata
  // creates dead "failed" cards that can never be retried. Pending extracted sections
  // are persisted separately, so a refresh still preserves useful OCR results.
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const uploadedFilesRef = useRef<UploadedFileItem[]>([]);
  useEffect(() => {
    uploadedFilesRef.current = uploadedFiles;
  }, [uploadedFiles]);

  const [isUploading, setIsUploading] = useState(false);
  const [isClearScreenshotsConfirmOpen, setIsClearScreenshotsConfirmOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    stage: string;
    detail?: string;
  } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrErrorMeta, setOcrErrorMeta] = useState<{ reasonCode?: string; retryable: boolean; retryAfter?: number } | null>(null);
  const [ocrRetryAfterSeconds, setOcrRetryAfterSeconds] = useState(0);

  useEffect(() => {
    if (ocrRetryAfterSeconds <= 0) return;
    const timer = window.setInterval(() => setOcrRetryAfterSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [ocrRetryAfterSeconds]);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const [lastWorkflowAction, setLastWorkflowAction] = useState<string | null>(null);

  // Network connectivity status
  const isOnline = sharedIsOnline ?? true;
  const wasOffline = sharedWasOffline;
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState(false);

  // Helper to test if a single manual form contains any user-entered content
  const isFormWithContent = (f: ManualFormState): boolean => {
    return (
      Boolean(f.name && f.name.trim() !== '') ||
      Boolean(f.courseCode && f.courseCode.trim() !== '') ||
      Boolean(f.sectionCode && f.sectionCode.trim() !== '') ||
      Boolean(
        f.sessions &&
        Array.isArray(f.sessions) &&
        f.sessions.some(
          (s) =>
            Boolean(s.day) ||
            Boolean(s.start && s.start.trim() !== '') ||
            Boolean(s.end && s.end.trim() !== '')
        )
      )
    );
  };

  // Helper to test if manual forms contain any user-entered content
  const hasManualFormWork = (forms: ManualFormState[]): boolean => {
    return forms.some(isFormWithContent);
  };

  // Parsed Pending Approval state (shows live preview before committing) with refresh/crash protection (Problem #4)
  const [pendingParsedSections, setPendingParsedSections] = useState<Section[] | null>(() => readPendingReview());

  const pendingReviewRecoveredWithoutEvidence = pendingParsedSections !== null && pendingParsedSections.length > 0 && uploadedFiles.length === 0;
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (savedCourseGroups.length === 0 && (pendingParsedSections?.length ?? 0) === 0 && uploadedFiles.length === 0) {
      setWorkflowPanel((current) => (current === 'manual' || current === 'screenshots') ? current : 'start');
      return;
    }
    if (savedCourseGroups.length === 0 && ((pendingParsedSections?.length ?? 0) > 0 || uploadedFiles.length > 0)) {
      setWorkflowPanel((current) => current === 'manual' ? current : 'screenshots');
      return;
    }
    if (savedCourseGroups.length > 0) {
      setWorkflowPanel('preferences');
    }
  }, [savedCourseGroups.length, (pendingParsedSections?.length ?? 0), uploadedFiles.length]);


  // Success Confirmation Popup (Stays until user acts)
  const [isAddedSuccessPopupOpen, setIsAddedSuccessPopupOpen] = useState(false);
  const [addedCoursesCount, setAddedCoursesCount] = useState<number>(0);
  const [skippedDuplicatesCount, setSkippedDuplicatesCount] = useState<number>(0);
  const [creditsAdjustedCount, setCreditsAdjustedCount] = useState<number>(0);
  const closeAddedSuccessPopup = () => {
    setIsAddedSuccessPopupOpen(false);
    window.setTimeout(() => {
      document.getElementById('responsive-fit-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // Close course review without discarding the queue
  const handleClosePendingModal = () => {
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
  };

  // Discard pending sections queue explicitly
  const handleDiscardPendingSections = () => {
    setPendingParsedSections(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setOcrNotice('The courses found in your screenshots were cleared from review.');
  };

  useEffect(() => {
    if (pendingReviewRecoveredWithoutEvidence) setOcrNotice('A pending course review was recovered, but the original screenshot files are no longer available in this session. Review the extracted course data carefully before saving.');
  }, [pendingReviewRecoveredWithoutEvidence]);

  const pendingModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isReviewModalOpen && pendingParsedSections !== null && pendingParsedSections.length > 0,
    onClose: handleClosePendingModal,
  });

  const successPopupRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isAddedSuccessPopupOpen,
    onClose: () => setIsAddedSuccessPopupOpen(false),
  });

  const detailsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isDetailsModalOpen,
    onClose: () => setIsDetailsModalOpen(false),
  });

  const screenshotTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isScreenshotTipsOpen,
    onClose: () => setIsScreenshotTipsOpen(false),
    restoreFocusRef: screenshotTipsTriggerRef,
  });
  const manualTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isManualTipsOpen,
    onClose: () => setIsManualTipsOpen(false),
    restoreFocusRef: manualTipsTriggerRef,
  });
  const preferencesTipsModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isPreferencesTipsOpen,
    onClose: () => setIsPreferencesTipsOpen(false),
    restoreFocusRef: preferencesTipsTriggerRef,
  });

  // Manual Entry state with refresh/crash protection (Problem #11)
  const [manualForms, setManualForms] = useState<ManualFormState[]>(() => {
    const recovered = readManualForms();
    return recovered || [createEmptyManualForm('1')];
  });

  const [manualError, setManualError] = useState<string | null>(null);


  // Persist one versioned snapshot to both stores. Local storage is the durable
  // copy; session storage is a recovery fallback when durable storage is unavailable.
  const lastPendingPersistedResetVersionRef = useRef(resetVersion);
  const lastManualPersistedResetVersionRef = useRef(resetVersion);
  useEffect(() => {
    if (lastPendingPersistedResetVersionRef.current !== resetVersion) { lastPendingPersistedResetVersionRef.current = resetVersion; return; }
    if (pendingParsedSections && pendingParsedSections.length > 0) {
      const localOk = savePendingReview({ reviewGenerationId: String(ocrBatchGenerationRef.current), createdAt: Date.now(), sourceFileCount: uploadedFilesRef.current.length, sourceFileFingerprints: uploadedFilesRef.current.map((f) => f.contentHash || f.visualFingerprint || `${f.name}:${f.file?.size || 0}`).slice(0, 30), ocrRunId: pendingParsedSections[0]?.ocrRunId, sections: pendingParsedSections });
      setPersistenceWarning(!localOk);
    } else { clearPendingReview(); setPersistenceWarning(false); }
  }, [pendingParsedSections]);

  useEffect(() => {
    if (lastManualPersistedResetVersionRef.current !== resetVersion) { lastManualPersistedResetVersionRef.current = resetVersion; return; }
    const hasWork = hasManualFormWork(manualForms);
    const localOk = saveManualForms(manualForms);
    setPersistenceWarning(!localOk);
  }, [manualForms]);


  // Connectivity recovery is explicit: going back online never starts an expensive OCR run by itself.
  useEffect(() => {
    if (!isOnline || !wasOffline) return;
    const failed = uploadedFilesRef.current.filter((f) => f.status === 'failed');
    setOfflineNotice(failed.length > 0
      ? `Your connection is back. ${failed.length} screenshot${failed.length === 1 ? '' : 's'} can be retried.`
      : 'Your connection is back.'
    );
    const timer = window.setTimeout(() => setOfflineNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [isOnline, wasOffline]);

  // Only warn for work that cannot be recovered from the persisted draft.
  useEffect(() => {
    const hasInFlightUpload = isUploading || isPreparingFiles || uploadedFiles.some((f) => f.status === 'processing');
    const hasNonRecoverableWork = hasInFlightUpload || persistenceWarning;
    if (!hasNonRecoverableWork) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingParsedSections, manualForms, isUploading, uploadedFiles]);

  // Edit Section state (#2)
  const [editingSection, setEditingSection] = useState<{
    originalId: string;
    originalCourseName: string;
    courseName: string;
    courseCode: string;
    sectionCode: string;
    credits: string;
    instructor?: string;
    sessions: ManualMeetingRow[];
    error?: string | null;
  } | null>(null);

  const editSectionModalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: editingSection !== null,
    onClose: () => setEditingSection(null),
  });

  // Live Combinatorial Schedule Estimation (computed asynchronously to prevent UI thread blocking)
  const [liveEstimate, setLiveEstimate] = useState<{
    totalValid: number;
    bestGap: number;
    impossibleDiagnostic?: any;
    achievableCredits?: any;
    wasSampled?: boolean;
    wasCapped?: boolean;
    searchCompleteness?: 'exhaustive' | 'sampled' | 'capped' | 'cancelled' | 'not_searched' | 'preflight_rejected';
  } | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateRequestIdRef = useRef<number>(0);
  const estimateTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => () => {
    estimateRequestIdRef.current++;
    estimateTaskRef.current?.cancel();
    estimateTaskRef.current = null;
  }, []);

  useEffect(() => {
    if (sections.length === 0 || !isPreferencesValid) {
      estimateRequestIdRef.current++;
      estimateTaskRef.current?.cancel();
      estimateTaskRef.current = null;
      setLiveEstimate(null);
      setEstimateError(null);
      setIsEstimating(false);
      return;
    }

    const currentReqId = ++estimateRequestIdRef.current;
    setIsEstimating(true);
    setEstimateError(null);

    const timer = setTimeout(async () => {
      if (currentReqId !== estimateRequestIdRef.current) return;
      try {
        const { courseMap, fixedCourses } = buildOptimizerCourseMap(sections);

        const task = runOptimizerAsyncCancellable({
          courses: courseMap,
          fixedCourses,
          preferences,
          mode: 'estimate',
        }, { owner: 'live-estimate', cancelPreviousOwner: true });
        estimateTaskRef.current = task;
        const res = await task.promise;

        // Discard result if a newer estimation request has been dispatched in the meantime (Problem #9)
        if (currentReqId !== estimateRequestIdRef.current) return;

        let totalValid = 0;
        let bestGap = Infinity;
        for (let d = 1; d <= 7; d++) {
          totalValid += res.totalFoundByDay?.[d] ?? (res.byDayCount[d] || []).length;
          const list = res.byDayCount[d] || [];
          for (const s of list) {
            if (s.totalGap < bestGap) bestGap = s.totalGap;
          }
        }
        setLiveEstimate({
          totalValid,
          bestGap: bestGap === Infinity ? 0 : bestGap,
          impossibleDiagnostic: res.impossibleDiagnostic,
          achievableCredits: res.achievableCredits,
          wasSampled: res.wasSampled,
          wasCapped: res.wasCapped,
          searchCompleteness: res.searchCompleteness,
        });
        setIsEstimating(false);
      } catch (e) {
        console.error('Optimizer calculation error in worker:', e);
        if (currentReqId === estimateRequestIdRef.current) {
          setLiveEstimate({ totalValid: 0, bestGap: 0, wasSampled: true, searchCompleteness: 'sampled' });
          setEstimateError('The quick option check is unavailable right now. You can still search using your current choices.');
          setIsEstimating(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      if (estimateTaskRef.current) {
        estimateTaskRef.current.cancel();
        estimateTaskRef.current = null;
      }
    };
  }, [sections, preferences, savedCourseGroups.length, isPreferencesValid]);

  const abortableDelay = useCallback((ms: number, abortSignal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (abortSignal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => { window.clearTimeout(timer); abortSignal.removeEventListener('abort', onAbort); };
    abortSignal.addEventListener('abort', onAbort, { once: true });
  }), []);

  // Handle Drag & Drop / File Select for Screenshots with size, identity, and count guards.
  const MAX_SCREENSHOTS_PER_BATCH = 30;
  const handleFileSelect = useCallback(async (files: FileList | File[] | null) => {
    if (isUploading || ocrProcessingRef.current || filePreparationRef.current) {
      setOcrNotice('Finish reading the current screenshots before adding more.');
      return;
    }
    if (!files) return;
    const fileList = Array.isArray(files) ? files : Array.from(files);
    if (fileList.length === 0) return;

    filePreparationRef.current = true;
    setIsPreparingFiles(true);
    const preparationGeneration = ++filePreparationGenerationRef.current;
    setOcrError(null);
    setOcrErrorMeta(null);
    setOcrRetryAfterSeconds(0);
    setOcrNotice(null);

    try {
      const existingFiles = uploadedFilesRef.current;
      const currentTotalBytes = existingFiles.reduce((acc, f) => acc + (f.file ? f.file.size : 0), 0);

      const validNewFiles: UploadedFileItem[] = [];
      let incomingBytes = 0;
      const warnings: string[] = [];
      const seenHashes = new Set<string>();
      const existingHashes = new Set(existingFiles.map((f) => f.contentHash).filter(Boolean) as string[]);
      const existingFingerprints = existingFiles.map((f) => f.visualFingerprint).filter(Boolean) as string[];

      for (const file of fileList) {
        if (!isSupportedScheduleImage(file)) {
          warnings.push(`"${file.name}" was skipped because only PNG, JPG, JPEG, or WebP images are supported.`);
          continue;
        }

        if (file.size <= 0) {
          warnings.push(`"${file.name}" was skipped because the file is empty.`);
          continue;
        }

        if (file.size > MAX_SINGLE_FILE_BYTES) {
          const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
          warnings.push(`"${file.name}" was skipped because it exceeds the 50 MB limit (${sizeMb} MB).`);
          continue;
        }

        if (existingFiles.length + validNewFiles.length >= MAX_SCREENSHOTS_PER_BATCH) {
          warnings.push(`You can add up to ${MAX_SCREENSHOTS_PER_BATCH} screenshots at a time.`);
          break;
        }

        if (currentTotalBytes + incomingBytes + file.size > MAX_TOTAL_BYTES) {
          warnings.push('The screenshot queue reached its 120 MB source-file limit. The remaining files were skipped.');
          break;
        }

        // Exact duplicate detection is content-based. File metadata is only a hint and
        // is never sufficient to drop evidence.
        const contentHash = await sha256File(file);
        if (preparationGeneration !== filePreparationGenerationRef.current) return;
        if (contentHash && (existingHashes.has(contentHash) || seenHashes.has(contentHash))) {
          warnings.push(`"${file.name}" is an exact duplicate of a screenshot already selected, so it was skipped.`);
          continue;
        }
        if (contentHash) seenHashes.add(contentHash);

        const shouldFingerprint = existingFingerprints.length > 0 || validNewFiles.some((candidate) => Boolean(candidate.visualFingerprint));
        const visual = shouldFingerprint ? await visualFingerprint(file) : null;
        if (preparationGeneration !== filePreparationGenerationRef.current) return;
        if (visual) {
          const nearDuplicate = [...existingFingerprints, ...validNewFiles.map((f) => f.visualFingerprint).filter(Boolean) as string[]]
            .some((candidate) => (fingerprintDistance(visual, candidate) ?? Number.MAX_SAFE_INTEGER) <= 24);
          if (nearDuplicate) {
            warnings.push(`"${file.name}" looks very similar to another screenshot. Both were kept because they may contain different timetable details.`);
          }
        }

        incomingBytes += file.size;
        validNewFiles.push({
          id: createLocalId('upload'),
          file,
          preview: URL.createObjectURL(file),
          name: file.name,
          contentHash,
          visualFingerprint: visual,
          status: 'processing',
        });
      }

      if (preparationGeneration !== filePreparationGenerationRef.current) return;

      if (validNewFiles.length === 0) {
        setOcrError(warnings[0] || 'Choose image files under 50 MB each.');
        return;
      }

      if (warnings.length > 0) setOcrNotice(warnings.join(' '));

      const nextFiles = [...existingFiles, ...validNewFiles];
      setUploadedFiles(nextFiles);
      setPendingParsedSections(null);
      setIsReviewModalOpen(false);
      setActiveCourseIndex(0);
      safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
      safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
      dispatchWorkflow({ type: 'UPLOAD_STARTED' });
      setIsUploading(true);
      setUploadProgress({ stage: 'Preparing screenshots', detail: 'Getting your screenshots ready…' });

      // Re-run the complete selected screenshot corpus whenever new screenshots are added. This keeps OCR
      // reconciliation order-independent and ensures newly added screenshots are evaluated as
      // part of the same visual evidence set instead of silently replacing the previous result.
      await handleProcessScreenshotsRef.current(nextFiles);
    } finally {
      if (preparationGeneration === filePreparationGenerationRef.current) {
        filePreparationRef.current = false;
        setIsPreparingFiles(false);
      }
    }
  }, [isUploading]);

  // Global clipboard paste support for screenshots (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        setActiveTab('screenshot');
        setWorkflowPanel('screenshots');
        void handleFileSelect(files);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleFileSelect]);

  const handleRemoveFile = (fileId: string) => {
    if (filePreparationRef.current) {
      setOcrNotice('Finish preparing the selected screenshots before removing one.');
      return;
    }
    // Removing one image invalidates the in-flight corpus response. Abort the shared request
    // and advance the generation so an already-returning response cannot repopulate stale data.
    ocrBatchGenerationRef.current += 1;
    ocrAbortControllerRef.current?.abort(new Error('CORPUS_CHANGED'));
    ocrItemControllersRef.current.get(fileId)?.abort();
    ocrItemControllersRef.current.clear();
    const fileToRemove = uploadedFilesRef.current.find((f) => f.id === fileId);
    if (fileToRemove?.preview) URL.revokeObjectURL(fileToRemove.preview);
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
    setPendingParsedSections(null);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setOcrError(null);
    setOcrErrorMeta(null);
    setOcrNotice(null);
    setUploadProgress(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAllFilesNow = () => {
    filePreparationGenerationRef.current += 1;
    filePreparationRef.current = false;
    setIsPreparingFiles(false);
    ocrBatchGenerationRef.current += 1;
    ocrAbortControllerRef.current?.abort();
    ocrItemControllersRef.current.forEach((controller) => controller.abort());
    ocrItemControllersRef.current.clear();
    uploadedFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setUploadedFiles([]);
    setPendingParsedSections(null);
    setIsDragActive(false);
    dispatchWorkflow({ type: 'RESET' });
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsUploading(false);
    setOcrError(null);
    setOcrNotice(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClearAllFiles = () => {
    if (filePreparationRef.current) {
      clearAllFilesNow();
      return;
    }
    if (isUploading || ocrProcessingRef.current) {
      setIsClearScreenshotsConfirmOpen(true);
      return;
    }
    clearAllFilesNow();
  };

  // User cancellation of active OCR processing
  const handleCancelOCR = () => {
    ocrBatchGenerationRef.current += 1;
    if (ocrAbortControllerRef.current) ocrAbortControllerRef.current.abort();
    ocrItemControllersRef.current.forEach((controller) => controller.abort());
    ocrItemControllersRef.current.clear();
    setIsUploading(false);
    setUploadProgress(null);
    setLastWorkflowAction('Screenshot reading was stopped.');
    dispatchWorkflow({ type: 'CANCELLED' });
    setUploadedFiles((prev) =>
      prev.map((f) => (f.status === 'processing' ? { ...f, status: 'idle' } : f))
    );
    setOcrNotice('Screenshot reading was stopped. Images remain ready to process.');
  };

  /**
   * Humanize and sanitize OCR error messages so students never see raw technical or network exceptions.
   */
  const getFriendlyOcrErrorMessage = (
    itemErr: any,
    reasonCode?: string
  ): string => {
    if (reasonCode === 'MODEL_UNPARSEABLE') {
      return 'We couldn’t read this screenshot properly. Try it again. The screenshot itself may be fine.';
    }
    if (reasonCode === 'UPSTREAM_ERROR' || reasonCode === 'UPSTREAM_BUSY') {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }
    if (reasonCode === 'NO_SCHEDULE_FOUND') {
      return 'We couldn’t read the course times from this screenshot. Try a clearer image or enter the course manually.';
    }

    if (itemErr?.isTimeout || itemErr?.name === 'TimeoutError' || itemErr?.message === 'CLIENT_TIMEOUT') {
      return 'That took too long. Try again.';
    }

    if (itemErr?.name === 'AbortError' || itemErr?.message === 'ABORTED') {
      return 'Screenshot reading was stopped.';
    }

    const rawMsg = String(itemErr?.message || '').toLowerCase();
    const isNetworkFailure =
      itemErr instanceof TypeError ||
      itemErr?.name === 'TypeError' ||
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      rawMsg.includes('failed to fetch') ||
      rawMsg.includes('networkerror') ||
      rawMsg.includes('load failed') ||
      rawMsg.includes('network request failed') ||
      rawMsg.includes('err_connection') ||
      rawMsg.includes('err_internet_disconnected');

    if (isNetworkFailure) {
      return 'Your internet connection was lost. Check it and try again.';
    }

    if (itemErr?.reasonCode === 'OCR_CORPUS_TOO_LARGE' || rawMsg.includes('corpus limit') || rawMsg.includes('total image payload')) {
      return 'The complete screenshot set is too large for one OCR pass. Remove or compress some screenshots and try again.';
    }

    if (itemErr?.reasonCode === 'IMAGE_TOO_LARGE' || itemErr?.status === 413 || rawMsg.includes('per-image limit') || rawMsg.includes('maximum allowed size')) {
      return 'This screenshot is over the per-image limit. Crop or compress it, then try again.';
    }

    if (itemErr?.status === 429 || rawMsg.includes('429') || rawMsg.includes('quota') || rawMsg.includes('resource_exhausted')) {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }

    if (itemErr?.status >= 500 || rawMsg.includes('500') || rawMsg.includes('503') || rawMsg.includes('service')) {
      return 'The screenshot reader is busy right now. Try again in a moment.';
    }

    if (
      typeof itemErr?.message === 'string' &&
      itemErr.message.trim() &&
      !rawMsg.includes('fetch') &&
      !rawMsg.includes('typeerror') &&
      !rawMsg.includes('object object')
    ) {
      return itemErr.message;
    }

    return 'We couldn’t read this screenshot. Try it again.';
  };

  const getOcrErrorMeta = (itemErr: any) => {
    const reasonCode = typeof itemErr?.reasonCode === 'string' ? itemErr.reasonCode : undefined;
    const retryable = itemErr?.retryable === true || ['UPSTREAM_ERROR', 'UPSTREAM_BUSY', 'OCR_TIMEOUT', 'CLIENT_TIMEOUT', 'NETWORK_ERROR'].includes(reasonCode || '') || itemErr?.status === 429 || itemErr?.status >= 500 || itemErr?.name === 'TypeError';
    const retryAfter = typeof itemErr?.retryAfter === 'number' && Number.isFinite(itemErr.retryAfter) ? Math.max(0, Math.ceil(itemErr.retryAfter)) : undefined;
    return { reasonCode, retryable, retryAfter };
  };

  // Process screenshots as one logical evidence batch. The server receives multiple images together
  // so the model can associate a course header from one screenshot with meetings from another.
  const handleProcessScreenshots = async (filesOverride?: UploadedFileItem[]) => {
    if (ocrProcessingRef.current) return;
    const allFiles = filesOverride && filesOverride.length > 0 ? filesOverride : uploadedFiles;
    if (!allFiles.length) return;
    if (!isOnline) {
      setOcrError('You’re offline. Reconnect to read screenshots.');
      setIsUploading(false);
      return;
    }

    // The OCR contract is corpus-wide: every run sees the complete current screenshot set.
    // File status describes UI state only and must never determine the evidence sent to OCR.
    const effectiveFiles = allFiles;

    ocrProcessingRef.current = true;
    dispatchWorkflow({ type: 'EXTRACTION_STARTED' });
    const batchPerfTimer = startPerformanceTimer();
    const batchGeneration = ++ocrBatchGenerationRef.current;
    const abortController = new AbortController();
    ocrAbortControllerRef.current = abortController;
    const { signal } = abortController;

    setIsUploading(true);
    setOcrError(null);
    setOcrNotice(null);

    const targetIdSet = new Set(effectiveFiles.map((f) => f.id));
    setUploadedFiles((prev) => prev.map((f) => targetIdSet.has(f.id) ? { ...f, status: 'processing', errorMessage: undefined, errorReasonCode: undefined, retryable: undefined, retryAfter: undefined } : f));

    const accumulatedSections: Section[] = [];
    let sentCount = 0;
    let usefulSectionCount = 0;
    let failCount = 0;
    let completedCount = 0;
    const totalToProcess = effectiveFiles.length;
    const completedDurations: number[] = [];
    let lastOcrReasonCode: string | undefined;

    const updateProgress = () => {
      const avgSec = completedDurations.length
        ? completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length
        : 0;
      const remaining = totalToProcess - completedCount;
      const estimatedSeconds = avgSec > 0 && remaining > 0 ? Math.max(1, Math.round(remaining * avgSec)) : undefined;
      setUploadProgress({
        stage: completedCount === 0 ? 'Reading all screenshots' : 'Checking the information we found',
        detail: estimatedSeconds ? 'Still working on the complete screenshot set…' : 'Comparing the screenshots as one evidence set…',
      });
    };

    try {
      updateProgress();

      // Prepare every selected image for one corpus request. Never split the corpus into
      // independent OCR requests because section identity depends on cross-image evidence.
      const prepared: Array<{ item: UploadedFileItem; data: string; mimeType: string }> = [];
      for (const item of effectiveFiles) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!item.file) {
          failCount++;
          completedCount++;
          setUploadedFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'failed', errorMessage: 'This screenshot is no longer available. Upload it again.', errorReasonCode: 'FILE_UNAVAILABLE', retryable: false } : f));
          updateProgress();
          continue;
        }
        try {
          const cacheKey = item.contentHash || `${item.file.type}:${item.file.size}:${item.file.lastModified}`;
          let optimized = OCR_PREPARATION_CACHE.get(cacheKey);
          if (!optimized) {
            optimized = await optimizeImageForOCR(item.file);
            OCR_PREPARATION_CACHE.set(cacheKey, optimized);
            while (OCR_PREPARATION_CACHE.size > OCR_PREPARATION_CACHE_MAX) {
              const oldest = OCR_PREPARATION_CACHE.keys().next().value;
              if (oldest === undefined) break;
              OCR_PREPARATION_CACHE.delete(oldest);
            }
          }
          if (optimized.warning) setOcrNotice(optimized.warning);
          prepared.push({ item, data: optimized.base64, mimeType: optimized.mimeType });
        } catch (err: any) {
          failCount++;
          completedCount++;
          const meta = getOcrErrorMeta(err);
          setUploadedFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, status: 'failed', errorMessage: getFriendlyOcrErrorMessage(err), errorReasonCode: meta.reasonCode, retryable: meta.retryable, retryAfter: meta.retryAfter } : f));
          updateProgress();
        }
      }

      if (prepared.length === 0) {
        throw new Error('No readable screenshots remain in the selected corpus.');
      }

      const MAX_OCR_CORPUS_DECODED_BYTES = 120 * 1024 * 1024;
      const estimateBase64Bytes = (value: string) => {
        const clean = value.replace(/^data:[^,]+,/, '');
        const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
      };
      const preparedDecodedBytes = prepared.reduce((sum, entry) => sum + estimateBase64Bytes(entry.data), 0);
      if (preparedDecodedBytes > MAX_OCR_CORPUS_DECODED_BYTES) {
        const totalMb = (preparedDecodedBytes / (1024 * 1024)).toFixed(1);
        const message = `The complete screenshot set is ${totalMb} MB after optimization, above the 120 MB one-pass OCR limit. Remove or compress some screenshots and try again.`;
        setOcrError(message);
        setOcrErrorMeta({ reasonCode: 'OCR_CORPUS_TOO_LARGE', retryable: false });
        setUploadedFiles((prev) => prev.map((f) => prepared.some((e) => e.item.id === f.id) ? { ...f, status: 'failed', errorMessage: message, errorReasonCode: 'OCR_CORPUS_TOO_LARGE', retryable: false } : f));
        dispatchWorkflow({ type: 'ERROR' });
        return;
      }

      // IMPORTANT: send the entire selected screenshot set in ONE HTTP request.
      // Do not split by image count or create independent OCR batches. Gemini must receive
      // all available visual evidence in the same request so it can reason across repeated,
      // overlapping, partial, and randomly ordered screenshots.
      const requestController = new AbortController();
      let requestTimedOut = false;
      const requestTimeoutId = window.setTimeout(() => {
        requestTimedOut = true;
        requestController.abort(new Error('CLIENT_TIMEOUT'));
      }, OCR_CLIENT_TIMEOUT_MS);
      const forwardAbort = () => requestController.abort(signal.reason || new Error('CLIENT_ABORTED'));
      signal.addEventListener('abort', forwardAbort, { once: true });
      prepared.forEach((e) => ocrItemControllersRef.current.set(e.item.id, requestController));
      const started = Date.now();

      try {
        sentCount = prepared.length;
        const response = await fetch('/api/extract-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: prepared.map((e) => ({ data: e.data, mimeType: e.mimeType })), workflowGenerationId }),
          signal: requestController.signal,
        });

        if (!response) throw new Error('We didn’t get a response while reading the screenshots. Try again.');
        if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
        const data = await response.json().catch(() => ({}));
        if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
        if (!response.ok) {
          const apiError = parseApiErrorEnvelope(data);
          lastOcrReasonCode = apiError.reasonCode;
          const err: any = new Error(apiError.error || `Server responded with status ${response.status}`);
          err.status = response.status;
          err.reasonCode = apiError.reasonCode;
          err.retryAfter = apiError.retryAfter;
          err.retryable = apiError.retryable;
          throw err;
        }
        const contract = validateOcrApiResponse(data);
        if (!contract.valid) {
          const err: any = new Error('The schedule-reading service returned data that did not match the supported response format.');
          err.reasonCode = 'INVALID_RESPONSE_CONTRACT';
          throw err;
        }
        const sections = contract.sections.map((section) => ({ ...section, ocrRunId: section.ocrRunId || contract.ocrRunId, workflowGenerationId: section.workflowGenerationId || workflowGenerationId }));
        if (sections.length > 0) {
          accumulatedSections.push(...sections);
          usefulSectionCount = sections.length;
          setUploadedFiles((prev) => prev.map((f) =>
            prepared.some((e) => e.item.id === f.id)
              ? { ...f, status: 'corpus-ready', extractedSectionsCount: undefined, errorMessage: undefined }
              : f
          ));
        } else {
          lastOcrReasonCode = contract.reasonCode;
          failCount += prepared.length;
          const message = typeof data?.message === 'string' && data.message.trim()
            ? data.message
            : 'We couldn’t find course schedule details in these screenshots. Try clearer screenshots or enter the courses yourself.';
          setUploadedFiles((prev) => prev.map((f) =>
            prepared.some((e) => e.item.id === f.id)
              ? { ...f, status: 'failed', errorMessage: message, errorReasonCode: contract.reasonCode, retryable: false }
              : f
          ));
        }

        completedCount += prepared.length;
        completedDurations.push((Date.now() - started) / 1000 / Math.max(1, prepared.length));
        updateProgress();
      } catch (err: any) {
        if (signal.aborted) throw err;
        if (requestTimedOut) throw new Error('CLIENT_TIMEOUT');
        failCount += prepared.length;
        completedCount += prepared.length;
        completedDurations.push((Date.now() - started) / 1000 / Math.max(1, prepared.length));
        const meta = getOcrErrorMeta(err);
        const friendly = getFriendlyOcrErrorMessage(err, err?.reasonCode);
        setOcrErrorMeta(meta);
        setOcrRetryAfterSeconds(meta.retryAfter || 0);
        setUploadedFiles((prev) => prev.map((f) =>
          prepared.some((e) => e.item.id === f.id)
            ? { ...f, status: 'failed', errorMessage: friendly, errorReasonCode: meta.reasonCode, retryable: meta.retryable, retryAfter: meta.retryAfter }
            : f
        ));
        updateProgress();
      } finally {
        signal.removeEventListener('abort', forwardAbort);
        window.clearTimeout(requestTimeoutId);
        prepared.forEach((e) => ocrItemControllersRef.current.delete(e.item.id));
      }

      setUploadProgress({ stage: 'Checking the information we found', detail: 'Reviewing course, section, meeting, and conflict evidence…' });

      // Do not fill missing OCR credits from the catalog or any other heuristic.
      // Missing credit data is review state. The user can explicitly enter it in
      // the review dialog, which keeps the OCR layer lossless.
      if (signal.aborted || batchGeneration !== ocrBatchGenerationRef.current) throw new DOMException('Aborted', 'AbortError');
      const preparedSections = accumulatedSections.map((s) => ({ ...s }));
      const deduplicatedSections = deduplicateParsedBatch(preparedSections);
      if (deduplicatedSections.length > 0) {
        setActiveCourseIndex(0);
        setPendingParsedSections(deduplicatedSections);
        dispatchWorkflow({ type: failCount > 0 ? 'PARTIAL_SUCCESS' : 'REVIEW_REQUIRED' });
        setIsReviewModalOpen(true);
        if (failCount > 0) setOcrNotice(`We read ${sentCount} screenshot${sentCount === 1 ? '' : 's'} and found ${usefulSectionCount} usable course option${usefulSectionCount === 1 ? '' : 's'}. ${failCount} screenshot${failCount === 1 ? '' : 's'} still need another try.`);
      } else {
        const reasonCode = lastOcrReasonCode || 'NO_SCHEDULE_FOUND';
        setOcrError('We couldn’t get usable course details from the screenshot corpus. Replace the screenshots or enter the courses yourself.');
        setOcrErrorMeta({ reasonCode, retryable: false });
        setLastWorkflowAction('No usable course details were found.');
        dispatchWorkflow({ type: 'ERROR', reasonCode });
      }
      setIsUploading(false);
      setUploadProgress(null);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        setIsUploading(false);
        setUploadProgress(null);
        } else {
        console.error('OCR Batch Error:', err);
        const meta = getOcrErrorMeta(err);
        setOcrError(getFriendlyOcrErrorMessage(err, err?.reasonCode));
        setOcrErrorMeta(meta);
        setOcrRetryAfterSeconds(meta.retryAfter || 0);
        setLastWorkflowAction('Screenshot reading needs another try.');
        dispatchWorkflow({ type: meta.retryable ? 'RETRYABLE_ERROR' : 'ERROR', reasonCode: meta.reasonCode });
        setIsUploading(false);
        setUploadProgress(null);
        }
    } finally {
      recordPerformanceMetric('ocr-batch', batchPerfTimer(), {
        total: totalToProcess,
        completed: completedCount,
        successes: usefulSectionCount,
        failures: failCount,
        cancelled: signal.aborted,
      });
      ocrAbortControllerRef.current = null;
      ocrProcessingRef.current = false;
    }
  };

  handleProcessScreenshotsRef.current = handleProcessScreenshots;

  // Retry the complete current screenshot corpus. Failed-count is only a user-facing hint.
  const handleRetryFailed = () => {
    const failed = uploadedFilesRef.current.filter((f) => f.status === 'failed');
    if (!failed.length || isUploading) return;
    const retryAfter = ocrRetryAfterSeconds;
    if (retryAfter > 0) {
      setOcrNotice(`Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before retrying.`);
      return;
    }
    setLastWorkflowAction('Retrying the complete screenshot set.');
    void handleProcessScreenshots();
  };

  const courseGroupMatchesSection = (group: { courseKey?: string; courseCode?: string | null; courseName: string }, section: Section) =>
    (group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName)) === (section.courseKey || getCourseIdentityKey(section.courseCode, section.name));

  // Group pending parsed sections using code-first identity.
  const pendingCourseGroups = useMemo(() => {
    if (!pendingParsedSections) return [];
    return groupSectionsByCourse(pendingParsedSections);
  }, [pendingParsedSections]);

  const missingCreditCourses = useMemo(() => {
    return pendingCourseGroups.filter((g) => g.credits === null || g.credits === undefined);
  }, [pendingCourseGroups]);

  const hasMissingCredits = missingCreditCourses.length > 0;

  // Unresolved Ambiguous Times detection and helpers (Problem #5)
  const hasUnresolvedAmbiguousTimes = useMemo(() => {
    return (
      pendingParsedSections?.some(
        (s) => Array.isArray(s?.sessions) && s.sessions.some((sess) => sess?.ambiguousTime)
      ) ?? false
    );
  }, [pendingParsedSections]);

  const ambiguousMeetingsCount = useMemo(() => {
    if (!pendingParsedSections || !Array.isArray(pendingParsedSections)) return 0;
    let cnt = 0;
    for (const s of pendingParsedSections) {
      if (Array.isArray(s?.sessions)) {
        for (const sess of s.sessions) {
          if (sess?.ambiguousTime) cnt++;
        }
      }
    }
    return cnt;
  }, [pendingParsedSections]);

  const handleConfirmAmbiguousTime = (secId: string, sessionIndex: number) => {
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== secId) return s;
            const updatedMeetings = Array.isArray(s.sessions)
              ? s.sessions.map((sess, idx) =>
                  idx === sessionIndex ? { ...sess, ambiguousTime: false, resolvedFromAmbiguousTime: true } : sess
                )
              : [];
            return { ...s, sessions: updatedMeetings };
          })
        : null
    );
  };

  const handleConfirmAllAmbiguousTimes = () => {
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => ({
            ...s,
            sessions: s.sessions.map((sess, sessionIndex) => ({
        ...sess,
        id:
          sess.id ||
          `session-${sess.day}-${sess.start}-${sess.end}-${sessionIndex + 1}`,
        ambiguousTime: false,
        resolvedFromAmbiguousTime: Boolean(sess.ambiguousTime) || Boolean(sess.resolvedFromAmbiguousTime),
      })),
          }))
        : null
    );
  };

  const [activeCourseIndex, setActiveCourseIndex] = useState(0);
  const [reviewModalError, setReviewModalError] = useState<string | null>(null);
  const reviewScrollContainerRef = useRef<HTMLDivElement>(null);

  const handleNavigateCourse = (newIdx: number) => {
    setReviewModalError(null);
    const clamped = Math.max(0, Math.min(pendingCourseGroups.length - 1, newIdx));
    setActiveCourseIndex(clamped);
    if (reviewScrollContainerRef.current) {
      reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Keyboard navigation for Review Modal (ArrowLeft / ArrowRight)
  useEffect(() => {
    if (!isReviewModalOpen || !pendingCourseGroups.length) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigateCourse(activeCourseIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigateCourse(activeCourseIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReviewModalOpen, pendingCourseGroups.length, activeCourseIndex]);

  // Keep activeCourseIndex strictly within bounds of the current batch
  // Cleanup OCR abort and timeouts on unmount
  useEffect(() => {
    return () => {
      ocrBatchGenerationRef.current += 1;
      filePreparationGenerationRef.current += 1;
      filePreparationRef.current = false;
      if (ocrAbortControllerRef.current) ocrAbortControllerRef.current.abort();
      ocrItemControllersRef.current.forEach((controller) => controller.abort());
      ocrItemControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      uploadedFilesRef.current.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  useEffect(() => {
    if (pendingCourseGroups.length === 0) {
      if (activeCourseIndex !== 0) setActiveCourseIndex(0);
    } else if (activeCourseIndex >= pendingCourseGroups.length) {
      setActiveCourseIndex(0);
    }
  }, [pendingCourseGroups.length, activeCourseIndex]);

  const getInsertedCount = (result: AddSectionsResult): number => result.insertedSections.length;
  const getSkippedCount = (result: AddSectionsResult): number => result.skippedCount;

  // Set credit hours for remaining courses in the pending queue (does not overwrite already set courses)

  const acknowledgeSectionReview = (sectionId: string) => {
    setPendingParsedSections((prev) => prev ? prev.map((section) => section.id === sectionId ? { ...section, reviewAcknowledged: true } : section) : null);
  };

  // Confirm Pending Parsed Sections into Catalog
  const handleConfirmPendingSections = () => {
    if (!pendingParsedSections || (pendingParsedSections?.length ?? 0) === 0) return;

    const invalidCourse = pendingParsedSections.find((s) => !s.name?.trim());
    if (invalidCourse) {
      const msg = 'Every course needs a name before we can add it.';
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const missingCredits = pendingParsedSections.find(
      (s) => s.credits === null || s.credits === undefined || !Number.isFinite(Number(s.credits)) || Number(s.credits) < 0 || Number(s.credits) > 17
    );
    if (missingCredits) {
      const missingIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, missingCredits));
      if (missingIdx !== -1) {
        setActiveCourseIndex(missingIdx);
      }
      const msg = `Add valid credit hours for "${missingCredits.name}" before adding the extracted courses. Enter the missing credit hours before adding the extracted courses.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    // A missing visible course code is valid extraction state. Do not invent one and
    // do not block the lossless OCR result merely because the source did not show it.
    // The review UI keeps sectionCode=null/sectionCodeMissing=true so the user may
    // explicitly supply a code later when the institution requires one.

    const missingVisibleSection = pendingParsedSections.find((s) => Boolean(s.sectionCodeMissing) || !s.sectionCode?.trim());
    if (missingVisibleSection) {
      setOcrNotice(`Some extracted sections do not show a visible course code. Those sections are preserved exactly as extracted; add a course code only when you can confirm it from the source.`);
    }

    const unresolvedAmbiguous = pendingParsedSections.find((s) =>
      Array.isArray(s.sessions) && s.sessions.some((sess) => sess.ambiguousTime)
    );
    if (unresolvedAmbiguous) {
      const ambigIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, unresolvedAmbiguous));
      if (ambigIdx !== -1) {
        setActiveCourseIndex(ambigIdx);
      }
      const msg = `Check the AM/PM time for "${unresolvedAmbiguous.name}" before adding the extracted courses.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const internalConflict = pendingParsedSections.find((s) => {
      if (!Array.isArray(s.sessions)) return true;
      for (let i = 0; i < s.sessions.length; i++) {
        for (let j = i + 1; j < s.sessions.length; j++) {
          const a = s.sessions[i];
          const b = s.sessions[j];
          if (a.day === b.day && timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(b.start) < timeToMinutes(a.end)) return true;
        }
      }
      return false;
    });
    if (internalConflict) {
      const conflictIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, internalConflict));
      if (conflictIdx !== -1) {
        setActiveCourseIndex(conflictIdx);
      }
      const msg = `The meeting times for "${internalConflict.name}" overlap. Fix the times before adding the course.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const unresolvedReview = pendingParsedSections.find((section) => {
      const codes = Array.from(new Set((section.reviewReasons || []).map(reviewReasonCode)));
      const blocking = codes.some((code) => REVIEW_BLOCKING_CODES.has(code));
      const acknowledgementNeeded = codes.some((code) => REVIEW_ACKNOWLEDGEMENT_CODES.has(code));
      return blocking || (acknowledgementNeeded && !section.reviewAcknowledged);
    });
    if (unresolvedReview) {
      const reviewIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, unresolvedReview));
      if (reviewIdx !== -1) setActiveCourseIndex(reviewIdx);
      const codes = Array.from(new Set((unresolvedReview.reviewReasons || []).map(reviewReasonCode)));
      const blockingCode = codes.find((code) => REVIEW_BLOCKING_CODES.has(code));
      const message = blockingCode
        ? `${reviewReasonLabel(blockingCode)} Fix or confirm this issue before adding the extracted courses.`
        : `Please acknowledge the review note for "${unresolvedReview.name}" before adding the extracted courses.`;
      setReviewModalError(message);
      setOcrError(message);
      reviewScrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const duplicatePendingId = pendingParsedSections.find((s, idx) =>
      pendingParsedSections.some((other, otherIdx) =>
        otherIdx !== idx &&
        (other.courseKey || normalizeCourseName(other.name)) === (s.courseKey || normalizeCourseName(s.name)) &&
        (other.sectionCode || '').trim().toLowerCase() === (s.sectionCode || '').trim().toLowerCase() &&
        Boolean(other.sectionCodeMissing) === false && Boolean(s.sectionCodeMissing) === false
      )
    );
    if (duplicatePendingId) {
      const dupIdx = pendingCourseGroups.findIndex(
        (g) => normalizeCourseName(g.courseName) === normalizeCourseName(duplicatePendingId.name)
      );
      if (dupIdx !== -1) {
        setActiveCourseIndex(dupIdx);
      }
      const msg = `Course code "${duplicatePendingId.sectionCode}" is used more than once in "${duplicatePendingId.name}". Give each option its own course code.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const invalidMeeting = pendingParsedSections.find((s) =>
      !Array.isArray(s.sessions) ||
      s.sessions.length === 0 ||
      s.sessions.some((sess) =>
        !sess.day ||
        !ALL_DAYS.includes(sess.day) ||
        !/^\d{2}:\d{2}$/.test(sess.start) ||
        !/^\d{2}:\d{2}$/.test(sess.end) ||
        timeToMinutes(sess.start) >= timeToMinutes(sess.end)
      )
    );
    if (invalidMeeting) {
      const sessIdx = pendingCourseGroups.findIndex((g) => courseGroupMatchesSection(g, invalidMeeting));
      if (sessIdx !== -1) {
        setActiveCourseIndex(sessIdx);
      }
      const msg = `Fix the meeting time for "${invalidMeeting.name}" before adding the extracted courses. End time must be later than start time.`;
      setReviewModalError(msg);
      setOcrError(msg);
      if (reviewScrollContainerRef.current) {
        reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const finalizedSections = pendingParsedSections.map((s) => {
      const visibleCode = s.sectionCode?.trim() || '';
      const finalCourseName = sanitizeCourseNameOnly(s.name.trim());
      return {
        ...s,
        // Keep the OCR-generated internal ID as the application identity. The
        // visible course code is a separate source field and may legitimately be null.
        id: s.id,
        sectionCode: visibleCode || null,
        sectionCodeMissing: !visibleCode,
        name: finalCourseName,
        credits: Number(s.credits),
        courseKey: s.courseKey || getCourseIdentityKey(s.courseCode, finalCourseName),
        sessions: s.sessions.map((sess) => ({ ...sess, ambiguousTime: false, resolvedFromAmbiguousTime: Boolean(sess.resolvedFromAmbiguousTime) || Boolean(sess.ambiguousTime) })),
      };
    });

    const insertedResult = onAddSections(finalizedSections);
    const count = getInsertedCount(insertedResult);
    const skipped = getSkippedCount(insertedResult);
    setCreditsAdjustedCount(insertedResult.creditsAdjustedCount);

    setPendingParsedSections(null);
    safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW);
    safeStorage.sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW);
    setIsReviewModalOpen(false);
    setActiveCourseIndex(0);
    setAddedCoursesCount(count);
    setSkippedDuplicatesCount(skipped);
    setOcrError(null);
    setReviewModalError(null);
    dispatchWorkflow({ type: 'READY' });
    setLastWorkflowAction(failedScreenshotsBeforeSuccess > 0 ? `Courses are ready. ${failedScreenshotsBeforeSuccess} screenshot${failedScreenshotsBeforeSuccess === 1 ? '' : 's'} still need attention.` : 'Course details are ready.');
    setIsAddedSuccessPopupOpen(true);
    // Retain only failed screenshots so users can retry them if needed.
    setUploadedFiles((prev) => {
      const retained = prev.filter((f) => f.status === 'failed');
      prev.filter((f) => f.status !== 'failed').forEach((f) => URL.revokeObjectURL(f.preview));
      return retained;
    });
  };

  const handleUpdateCourseCredits = (courseName: string, creditsVal: number | null, autoAdvance: boolean = true, courseKey?: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(courseName);
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            const matches = courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey : normalizeCourseName(s.name) === targetNorm;
            return matches ? { ...s, credits: creditsVal } : s;
          })
        : null
    );

    if (autoAdvance && creditsVal !== null) {
      const currIdx = pendingCourseGroups.findIndex(
        (g) => courseKey ? g.courseKey === courseKey : normalizeCourseName(g.courseName) === targetNorm
      );
      const effectiveIdx = currIdx !== -1 ? currIdx : activeCourseIndex;
      if (effectiveIdx < pendingCourseGroups.length - 1) {
        setTimeout(() => {
          setActiveCourseIndex(effectiveIdx + 1);
          if (reviewScrollContainerRef.current) {
            reviewScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }, 160);
      }
    }
  };

  // Delete an entire extracted course from the review dialog before adding
  const handleDeletePendingCourse = (courseName: string, courseKey?: string) => {
    if (!pendingParsedSections) return;
    const targetNorm = normalizeCourseName(courseName);
    const remaining = pendingParsedSections.filter(
      (s) => courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) !== courseKey : normalizeCourseName(s.name) !== targetNorm
    );

    if (remaining.length === 0) {
      setPendingParsedSections(null);
      setActiveCourseIndex(0);
      setOcrNotice('The extracted courses were removed from review.');
    } else {
      setPendingParsedSections(remaining);
      setActiveCourseIndex((prev) => Math.min(prev, Math.max(0, pendingCourseGroups.length - 2)));
    }
  };

  // Rename an extracted course across all its sections in the review dialog
  const handleUpdatePendingCourseName = (oldName: string, newName: string, courseKey?: string) => {
    if (!pendingParsedSections) return;
    setReviewModalError(null);
    const targetNorm = normalizeCourseName(oldName);
    const cleanedName = sanitizeBoundedText(newName, 240).trim();
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            const matches = courseKey ? (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey : normalizeCourseName(s.name) === targetNorm;
            if (!matches) return s;
            // A course-code-backed identity remains code-backed after a title edit.
            return { ...s, name: cleanedName, courseKey: getCourseIdentityKey(s.courseCode, cleanedName), userOverrides: { ...(s.userOverrides || {}), name: cleanedName } };
          })
        : null
    );
  };

  // Update a specific section ID in the review dialog
  const handleUpdatePendingSectionId = (targetSec: Section, newId: string) => {
    if (!pendingParsedSections) return;
    const cleaned = newId;
    setPendingParsedSections((prev) =>
      prev ? prev.map((s) => (s.id === targetSec.id ? {
        ...s,
        sectionCode: cleaned,
        sectionCodeMissing: !cleaned.trim(),
        // Preserve the generated internal key while the user edits the visible code.
        id: s.id,
        needsReview: cleaned.trim() ? s.needsReview : true,
        reviewReasons: cleaned.trim()
          ? (s.reviewReasons || []).filter((r) => r !== 'section_code_missing')
          : Array.from(new Set([...(s.reviewReasons || []), 'section_code_missing'])),
      } : s)) : null
    );
  };

  // Delete a specific section from an extracted course
  const handleDeletePendingSection = (targetSec: Section, courseName: string) => {
    if (!pendingParsedSections) return;
    const targetNorm = normalizeCourseName(courseName);
    const targetKey = targetSec.courseKey || getCourseIdentityKey(targetSec.courseCode, targetSec.name);
    const courseSections = pendingParsedSections.filter(
      (s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === targetKey
    );

    if (courseSections.length <= 1) {
      // If only 1 section in course, deleting this section removes the course
      handleDeletePendingCourse(courseName, targetSec.courseKey);
      return;
    }

    setPendingParsedSections((prev) =>
      prev ? prev.filter((s) => s.id !== targetSec.id) : null
    );
  };

  // Add an alternate section to an extracted course
  const handleAddPendingSection = (courseName: string, credits: number | null, courseKey?: string) => {
    if (!pendingParsedSections) return;
    const targetNorm = normalizeCourseName(courseName);
    const resolvedTargetKey = courseKey || getCourseIdentityKey(null, targetNorm);
    const courseSections = pendingParsedSections.filter(
      (s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === resolvedTargetKey
    );

    const targetKey = courseSections[0]?.courseKey || resolvedTargetKey;
    const existingIds = new Set([
      ...savedCourseGroups.filter((g) => g.courseKey === targetKey).flatMap((g) => g.sections.map((s) => s.sectionCode?.trim().toLowerCase()).filter((code): code is string => Boolean(code))),
      ...pendingParsedSections.filter((s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === targetKey).map((s) => (s.sectionCode || '').trim().toLowerCase()).filter(Boolean),
    ]);
    let secNum = courseSections.length + 1;
    let candId = `SEC-${String(secNum).padStart(2, '0')}`;
    while (existingIds.has(candId.toLowerCase())) {
      secNum++;
      candId = `SEC-${String(secNum).padStart(2, '0')}`;
    }

    const newSection: Section = {
      id: `pending:${createLocalId('section')}`,
      name: courseName,
      courseKey: targetKey,
      sectionCode: candId,
      sectionCodeMissing: false,
      needsReview: false,
      credits: credits,
      sessions: [
        {
          id: createLocalId('pending-session'),
          day: 'MON',
          start: '',
          end: '',
          type: 'Lecture',
        },
      ],
    };

    setPendingParsedSections((prev) => (prev ? [...prev, newSection] : [newSection]));
  };

  // Update a specific session (day, start, end, type) in a section
  const handleUpdatePendingMeeting = (
    targetSec: Section,
    sessionIndex: number,
    field: keyof Meeting,
    val: any
  ) => {
    if (!pendingParsedSections) return;
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            const updatedMeetings = s.sessions.map((sess, idx) =>
              idx === sessionIndex
                ? {
                    ...sess,
                    [field]: val,
                    ...(field === 'start' || field === 'end' ? { ambiguousTime: false } : {}),
                  }
                : sess
            );
            return { ...s, sessions: updatedMeetings };
          })
        : null
    );
  };

  // Add a meeting session row to a section
  const handleAddPendingMeeting = (targetSec: Section) => {
    if (!pendingParsedSections) return;
    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            const newSess: Meeting = {
              id: createLocalId('pending-session'),
              day: 'MON',
              start: '',
              end: '',
              type: 'Lecture',
            };
            return { ...s, sessions: [...s.sessions, newSess] };
          })
        : null
    );
  };

  // Delete a meeting session row from a section (preserving at least one)
  const handleDeletePendingMeeting = (targetSec: Section, sessionIndex: number) => {
    if (!pendingParsedSections) return;
    if (targetSec.sessions.length <= 1) return;

    setPendingParsedSections((prev) =>
      prev
        ? prev.map((s) => {
            if (s.id !== targetSec.id) return s;
            return {
              ...s,
              sessions: s.sessions.filter((_, idx) => idx !== sessionIndex),
            };
          })
        : null
    );
  };

  // Manual Form Handlers
  const handleRemoveManualForm = (formIndex: number) => {
    setManualError(null);
    setManualForms((prev) => {
      if (prev.length <= 1) return [createEmptyManualForm('1')];
      return prev.filter((_, idx) => idx !== formIndex);
    });
    setResponsiveManualOpenIndex((current) => {
      if (current === null) return null;
      if (current === formIndex) return Math.max(0, current - 1);
      if (current > formIndex) return current - 1;
      return current;
    });
  };

  const handleAddMeetingRow = (formIndex: number, defaultType: MeetingType = 'Lecture') => {
    setManualError(null);
    setManualForms((prev) =>
      prev.map((f, idx) =>
        idx === formIndex
          ? {
              ...f,
              sessions: [
                ...f.sessions,
                createEmptyMeeting(createLocalId(`session-${f.sessions.length}`), defaultType),
              ],
            }
          : f
      )
    );
  };

  const handleRemoveMeetingRow = (formIndex: number, sessionIndex: number) => {
    setManualError(null);
    setManualForms((prev) =>
      prev.map((f, idx) =>
        idx === formIndex && f.sessions.length > 1
          ? {
              ...f,
              sessions: f.sessions.filter((_, sIdx) => sIdx !== sessionIndex),
            }
          : f
      )
    );
  };

  const isMeetingValid = (s: ManualMeetingRow) => {
    if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) return false;
    if (!s.start || !s.start.trim() || !s.end || !s.end.trim()) return false;
    const start = timeToMinutes(s.start);
    const end = timeToMinutes(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
    if (!isManualMeetingType(s.type)) return false;
    return s.type !== 'Custom' || Boolean(s.customType?.trim());
  };

  const hasMeetingOverlap = (sessions: ManualMeetingRow[]) => {
    const valid = sessions.filter(isMeetingValid);
    for (let i = 0; i < valid.length; i++) {
      const a = valid[i];
      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      for (let j = i + 1; j < valid.length; j++) {
        const b = valid[j];
        if (a.day !== b.day) continue;
        const bStart = timeToMinutes(b.start);
        const bEnd = timeToMinutes(b.end);
        if (aStart < bEnd && bStart < aEnd) return true;
      }
    }
    return false;
  };

  const isFormValid = (f: ManualFormState) => {
    if (!f.name.trim()) return false;
    if (!f.courseCode.trim()) return false;
    if (!f.sectionCode.trim()) return false;
    const rawCredits = f.credits.trim();
    if (!rawCredits || !/^\d+(\.\d+)?$/.test(rawCredits) || parseCreditHours(rawCredits) === null) return false;
    if (!f.sessions || f.sessions.length === 0) return false;
    if (!f.sessions.every(isMeetingValid)) return false;
    return !hasMeetingOverlap(f.sessions);
  };

  const scrollToErrorLocation = (
    formId?: string,
    field?: 'name' | 'courseCode' | 'sectionCode' | 'credits' | 'session',
    sessionId?: string
  ) => {
    if (!formId) return;
    setTimeout(() => {
      let targetEl: HTMLElement | null = null;
      if (sessionId) {
        targetEl = document.getElementById(`manual-session-${sessionId}`);
      } else if (field) {
        targetEl = document.getElementById(`manual-field-${formId}-${field}`);
      }
      if (!targetEl) {
        targetEl = document.getElementById(`manual-form-${formId}`);
      }
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input =
          targetEl.tagName === 'INPUT' || targetEl.tagName === 'SELECT'
            ? targetEl
            : targetEl.querySelector('input, select');
        (input as HTMLElement)?.focus();
      }
    }, 60);
  };

  const handleSaveManualSections = (): boolean => {
    setManualError(null);

    // Check if any form card has partial content (course code or times entered) but is missing course name
    for (let fIdx = 0; fIdx < manualForms.length; fIdx++) {
      const f = manualForms[fIdx];
      const hasName = f.name.trim().length > 0;
      const hasCourseCode = f.courseCode.trim().length > 0;
      const hasSectionCode = f.sectionCode.trim().length > 0;
      const hasMeetingTimes = f.sessions.some(
        (s) => (s.start && s.start.trim().length > 0) || (s.end && s.end.trim().length > 0)
      );

      if (!hasName && (hasCourseCode || hasSectionCode || hasMeetingTimes)) {
        const msg = `Add a course name for course ${fIdx + 1}${f.sectionCode ? ` ("${f.sectionCode}")` : ''}.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'name');
        return false;
      }
    }

    const formsWithContent = manualForms.filter((f) => f.name.trim().length > 0);

    for (const f of formsWithContent) {
      if (!f.courseCode.trim()) {
        const msg = 'Add a course code.';
        setManualError(msg);
        scrollToErrorLocation(f.id, 'courseCode');
        return false;
      }
      if (!f.sectionCode.trim()) {
        const msg = 'Add a section code.';
        setManualError(msg);
        scrollToErrorLocation(f.id, 'sectionCode');
        return false;
      }
    }

    if (formsWithContent.length === 0) {
      const msg = 'Add at least one course name.';
      setManualError(msg);
      scrollToErrorLocation(manualForms[0]?.id, 'name');
      return false;
    }

    // Validate course identity + visible section-code uniqueness separately.
    const seenSectionCompoundKeys = new Set<string>();
    for (const f of formsWithContent) {
      const courseCode = f.courseCode.trim();
      const sectionCode = f.sectionCode.trim();
      const courseKey = getCourseIdentityKey(courseCode, f.name);
      const canonicalSectionCode = canonicalizeSectionIdentity(sectionCode);
      const compoundKey = `${courseKey}:::${canonicalSectionCode.toLowerCase()}`;
      if (seenSectionCompoundKeys.has(compoundKey)) {
        const msg = `Section code "${sectionCode}" is used twice for course "${f.name.trim()}". Give each section its own section code.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'sectionCode');
        return false;
      }
      seenSectionCompoundKeys.add(compoundKey);

      const existsInCatalog = savedCourseGroups.some(
        (g) => g.courseKey === courseKey && g.sections.some((section) =>
          canonicalizeSectionIdentity(String(section.sectionCode || '')) === canonicalSectionCode
        )
      );
      if (existsInCatalog) {
        const msg = `Section code "${sectionCode}" already exists for "${f.name.trim()}". Use a different section code, or edit the existing section.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'sectionCode');
        return false;
      }
    }

    const validSections: Section[] = [];

    for (let fIdx = 0; fIdx < formsWithContent.length; fIdx++) {
      const f = formsWithContent[fIdx];
      const rawCourseName = sanitizeBoundedText(f.name, 160);
      const courseName = sanitizeCourseNameOnly(rawCourseName, `${f.courseCode} ${f.sectionCode}`);

      if (!f.sessions || f.sessions.length === 0) {
        const msg = `Add at least one meeting day and time for "${courseName}".`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'session');
        return false;
      }

      const validatedMeetings: Meeting[] = [];

      for (let sIdx = 0; sIdx < f.sessions.length; sIdx++) {
        const s = f.sessions[sIdx];
        if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) {
          const msg = `Choose a valid day for meeting #${sIdx + 1} of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (!s.start || !s.start.trim()) {
          const msg = `Enter a valid start time for meeting #${sIdx + 1} (${s.day}) of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (!s.end || !s.end.trim()) {
          const msg = `Enter a valid end time for meeting #${sIdx + 1} (${s.day}) of "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        const startMin = timeToMinutes(s.start);
        const endMin = timeToMinutes(s.end);
        if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
          const msg = `The start time must be earlier than the end time for meeting #${sIdx + 1} (${s.day}) in "${courseName}".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }

        if (!isManualMeetingType(s.type)) {
          const msg = `Choose a valid meeting type for meeting #${sIdx + 1} of \"${courseName}\".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }
        if (s.type === 'Custom' && !s.customType?.trim()) {
          const msg = `Enter a custom meeting type for meeting #${sIdx + 1} of \"${courseName}\".`;
          setManualError(msg);
          scrollToErrorLocation(f.id, 'session', s.id);
          return false;
        }

        const sessionType = s.type || 'Lecture';

        validatedMeetings.push({
          id: s.id || createLocalId('session'),
          day: s.day as DayOfWeek,
          start: s.start.trim(),
          end: s.end.trim(),
          type: sessionType,
          customType: s.type === 'Custom' ? (s.customType?.trim() || '') : '',
        });
      }

      // Validate that sessions within the same section do not conflict with each other
      for (let i = 0; i < validatedMeetings.length; i++) {
        const a = validatedMeetings[i];
        const aStart = timeToMinutes(a.start);
        const aEnd = timeToMinutes(a.end);
        for (let j = i + 1; j < validatedMeetings.length; j++) {
          const b = validatedMeetings[j];
          if (a.day === b.day) {
            const bStart = timeToMinutes(b.start);
            const bEnd = timeToMinutes(b.end);
            if (aStart < bEnd && bStart < aEnd) {
              const msg = `Meeting times #${i + 1} and #${j + 1} overlap on ${a.day} in "${courseName}". A section can’t have overlapping meeting times.`;
              setManualError(msg);
              scrollToErrorLocation(f.id, 'session', f.sessions[j]?.id);
              return false;
            }
          }
        }
      }

      // Credits validation: NEVER silently clamp out-of-range inputs!
      const rawCredits = f.credits ? f.credits.trim() : '';
      if (rawCredits === '') {
        const msg = `Add the credit hours for "${courseName}".`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      if (!/^\d+(\.\d+)?$/.test(rawCredits)) {
        const msg = `Credits for "${courseName}" must be a valid number.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      const parsedCredits = parseCreditHours(rawCredits);
      if (parsedCredits === null) {
        const msg = `Credits for "${courseName}" must be a valid number.`;
        setManualError(msg);
        scrollToErrorLocation(f.id, 'credits');
        return false;
      }
      const cleanCourseCode = sanitizeBoundedText(f.courseCode, 80);
      const sectionId = `${cleanCourseCode}::${sanitizeBoundedText(f.sectionCode, 80)}`;

      validSections.push({
        id: sectionId,
        name: courseName,
        courseCode: cleanCourseCode,
        sectionCode: sanitizeBoundedText(f.sectionCode, 80),
        credits: parsedCredits,
        instructor: f.instructor ? f.instructor.trim() : null,
        sourceKind: 'manual',
        editedFields: [],
        sessions: validatedMeetings,
      sourceEvidence: originalSection?.sourceEvidence || { sourceImageIndexes: originalSection?.sourceImageIndexes || [], ocrRunId: originalSection?.ocrRunId },
      userOverrides: {
        ...(originalSection?.userOverrides || {}),
        name: courseName, courseCode: cleanCourseCode, sectionCode: cleanSectionCode, credits: parsedCr, instructor: editingSection.instructor?.trim() || null, meetings: validatedMeetings.map((m) => `${m.day}|${m.start}|${m.end}|${m.type}|${m.customType || ''}`).join(';'),
      },
      editedFields: Array.from(new Set([...(originalSection?.editedFields || []), 'name','courseCode','sectionCode','credits','instructor','sessions'])),
      });
    }

    if (validSections.length > 0) {
      const insertedResult = onAddSections(validSections);
      const count = getInsertedCount(insertedResult);
      const skipped = getSkippedCount(insertedResult);
      setAddedCoursesCount(count);
      setCreditsAdjustedCount(insertedResult.creditsAdjustedCount);
      setSkippedDuplicatesCount(skipped);
      setIsAddedSuccessPopupOpen(true);
      setManualForms([createEmptyManualForm('1')]);
      try {
        safeStorage.sessionRemoveItem(STORAGE_KEY_MANUAL_FORMS);
      } catch {}
      setManualError(null);
        return true;
    }
    return false;
  };

  // Section Editing Handlers (#2)
  const handleStartEditSection = (sec: Section, courseName: string) => {
    setEditingSection({
      originalId: sec.id,
      originalCourseName: courseName,
      courseName: sec.name || courseName,
      courseCode: sec.courseCode || '',
      sectionCode: sec.sectionCode || '',
      credits: sec.credits == null ? '' : String(sec.credits),
      instructor: sec.instructor || '',
      sessions: sec.sessions.map((s, idx) => ({
        id: s.id || `edit-s-${idx}`,
        day: s.day,
        start: s.start,
        rawStart: s.start,
        end: s.end,
        rawEnd: s.end,
        type: isManualMeetingType(s.type) ? s.type : 'Custom',
        customType: s.type === 'Custom' ? (s.customType || '') : (!isManualMeetingType(s.type) ? s.type : ''),
      })),
      error: null,
    });
  };

  const handleAddEditMeeting = () => {
    setEditingSection((prev) => {
      if (!prev) return null;
      const newSess: ManualMeetingRow = {
        id: `edit-s-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        day: 'MON',
        start: '',
        rawStart: '',
        end: '',
        rawEnd: '', 
        type: 'Lecture',
        customType: '',
      };
      return {
        ...prev,
        sessions: [...prev.sessions, newSess],
      };
    });
  };

  const handleRemoveEditMeeting = (sessionIndex: number) => {
    setEditingSection((prev) => {
      if (!prev || prev.sessions.length <= 1) return prev;
      return {
        ...prev,
        sessions: prev.sessions.filter((_, idx) => idx !== sessionIndex),
      };
    });
  };

  const handleSaveEditSection = () => {
    if (!editingSection) return;
    const courseName = editingSection.courseName.trim();
    const courseCode = editingSection.courseCode.trim();
    const sectionCode = editingSection.sectionCode.trim();

    if (!courseName) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a course name.' } : null));
      return;
    }
    if (!courseCode) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a course code.' } : null));
      return;
    }
    if (!sectionCode) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add a section code.' } : null));
      return;
    }

    const rawCredits = editingSection.credits.trim();
    if (!rawCredits) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Enter credit hours.' } : null));
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(rawCredits)) {
      setEditingSection((prev) =>
        prev
          ? {
              ...prev,
              error: `Credits must be a valid number (entered: "${editingSection.credits}").`,
            }
          : null
      );
      return;
    }
    const parsedCr = parseCreditHours(rawCredits);
    if (parsedCr === null) {
      setEditingSection((prev) =>
        prev
          ? {
              ...prev,
              error: `Credits must be a valid number (entered: "${editingSection.credits}").`,
            }
          : null
      );
      return;
    }

    if (!editingSection.sessions || editingSection.sessions.length === 0) {
      setEditingSection((prev) => (prev ? { ...prev, error: 'Add at least one meeting time.' } : null));
      return;
    }

    const validatedMeetings: Meeting[] = [];
    for (let idx = 0; idx < editingSection.sessions.length; idx++) {
      const s = editingSection.sessions[idx];
      if (!s.day || !ALL_DAYS.includes(s.day as DayOfWeek)) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Choose a valid day for meeting #${idx + 1}.` } : null));
        return;
      }
      if (!s.start || !s.start.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a valid start time for meeting #${idx + 1} (${s.day}).` } : null));
        return;
      }
      if (!s.end || !s.end.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a valid end time for meeting #${idx + 1} (${s.day}).` } : null));
        return;
      }
      if (!isManualMeetingType(s.type)) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Choose a valid meeting type for meeting #${idx + 1}.` } : null));
        return;
      }
      if (s.type === 'Custom' && !s.customType?.trim()) {
        setEditingSection((prev) => (prev ? { ...prev, error: `Enter a custom meeting type for meeting #${idx + 1}.` } : null));
        return;
      }

      const sMin = timeToMinutes(s.start);
      const eMin = timeToMinutes(s.end);
      if (!Number.isFinite(sMin) || !Number.isFinite(eMin) || sMin >= eMin) {
        setEditingSection((prev) =>
          prev
            ? {
                ...prev,
                error: `Start time (${formatTo12Hour(s.start)}) must be strictly earlier than end time (${formatTo12Hour(s.end)}) for meeting #${idx + 1}.`,
              }
            : null
        );
        return;
      }

      validatedMeetings.push({
        id: s.id || createLocalId('session'),
        day: s.day as DayOfWeek,
        start: s.start.trim(),
        end: s.end.trim(),
        type: s.type === 'Custom' ? 'Custom' : (s.type || 'Lecture'),
        customType: s.type === 'Custom' ? (s.customType?.trim() || '') : '',
      });
    }

    // Validate that sessions within the edited section do not conflict with each other
    for (let i = 0; i < validatedMeetings.length; i++) {
      const a = validatedMeetings[i];
      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      for (let j = i + 1; j < validatedMeetings.length; j++) {
        const b = validatedMeetings[j];
        if (a.day === b.day) {
          const bStart = timeToMinutes(b.start);
          const bEnd = timeToMinutes(b.end);
          if (aStart < bEnd && bStart < aEnd) {
            setEditingSection((prev) =>
              prev
                ? {
                    ...prev,
                    error: `Meeting times #${i + 1} (${formatTo12Hour(a.start)}-${formatTo12Hour(a.end)}) and #${j + 1} (${formatTo12Hour(b.start)}-${formatTo12Hour(b.end)}) overlap on ${a.day}. Meeting times in the same section cannot overlap.`,
                  }
                : null
            );
            return;
          }
        }
      }
    }

    // Course name is course identity. A section edit may not silently merge into
    // another course. A rename to a new course is explicit and clearly described.
    const newCourseKey = getCourseIdentityKey(courseCode, courseName);
    const originalSectionForEdit = sections.find((sec) => sec.id === editingSection.originalId && normalizeCourseName(sec.name) === normalizeCourseName(editingSection.originalCourseName));
    const originalCourseKey = originalSectionForEdit?.courseKey || getCourseIdentityKey(originalSectionForEdit?.courseCode, originalSectionForEdit?.name || editingSection.originalCourseName);
    const targetGroup = savedCourseGroups.find((g) => g.courseKey === newCourseKey);
    if (newCourseKey !== originalCourseKey) {
      if (targetGroup) {
        setEditingSection((prev) =>
          prev ? { ...prev, error: `This section can’t be moved into "${courseName}" because it could mix unrelated course data. Edit the target course separately instead.` } : null
        );
        return;
      }
      // A move to a new course identity is allowed only when that identity does not already exist.
    }
    // Check collision with another section in the same logical course
    if (targetGroup) {
      const hasCollision = targetGroup.sections.some(
        (s) => canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalizeSectionIdentity(sectionCode) &&
          s.id.toLowerCase() !== editingSection.originalId.toLowerCase()
      );
      if (hasCollision) {
        setEditingSection((prev) =>
          prev ? { ...prev, error: `Section "${sectionCode}" already exists for "${courseName}". Choose a different section code.` } : null
        );
        return;
      }
    }

    const originalSection = originalSectionForEdit;
    const cleanCourseCode = sanitizeBoundedText(courseCode, 80);
    const cleanSectionCode = sanitizeBoundedText(sectionCode, 80);
    const updatedSection: Section = {
      ...(originalSection || {}),
      id: originalSection?.id || `${cleanCourseCode}::${cleanSectionCode}`,
      name: courseName,
      courseCode: cleanCourseCode,
      sectionCode: cleanSectionCode,
      courseKey: getCourseIdentityKey(cleanCourseCode, courseName),
      credits: parsedCr,
      instructor: editingSection.instructor?.trim() || originalSection?.instructor || null,
      sessions: validatedMeetings,
      sourceEvidence: originalSection?.sourceEvidence || { sourceImageIndexes: originalSection?.sourceImageIndexes || [], ocrRunId: originalSection?.ocrRunId },
      userOverrides: {
        ...(originalSection?.userOverrides || {}),
        name: courseName, courseCode: cleanCourseCode, sectionCode: cleanSectionCode, credits: parsedCr, instructor: editingSection.instructor?.trim() || null, meetings: validatedMeetings.map((m) => `${m.day}|${m.start}|${m.end}|${m.type}|${m.customType || ''}`).join(';'),
      },
      editedFields: Array.from(new Set([...(originalSection?.editedFields || []), 'name','courseCode','sectionCode','credits','instructor','sessions'])),
    };

    const updateAccepted = onUpdateSection?.(editingSection.originalId, updatedSection, editingSection.originalCourseName);
    if (updateAccepted === false) {
      setEditingSection((prev) => prev ? { ...prev, error: 'This edit would collide with an existing course or section. No changes were saved.' } : null);
      return;
    }
    setEditingSection(null);
  };

  const formsWithContent = manualForms.filter(isFormWithContent);
  const hasIncompleteManualDraft = manualForms.some((f) => isFormWithContent(f) && !f.name.trim());
  const hasManualIdentityCollision = (() => {
    const seen = new Set<string>();
    for (const f of formsWithContent) {
      if (!f.courseCode.trim() || !f.sectionCode.trim()) return true;
      const key = `${getCourseIdentityKey(f.courseCode, f.name)}:::${canonicalizeSectionIdentity(f.sectionCode).toLowerCase()}`;
      if (seen.has(key)) return true;
      seen.add(key);
      const group = savedCourseGroups.find((g) => g.courseKey === getCourseIdentityKey(f.courseCode, f.name));
      if (group?.sections.some((section) => canonicalizeSectionIdentity(String(section.sectionCode || '')) === canonicalizeSectionIdentity(f.sectionCode))) return true;
    }
    return false;
  })();
  const canSaveManualBatch = formsWithContent.length > 0 && !hasIncompleteManualDraft && !hasManualIdentityCollision && formsWithContent.every(isFormValid);

  // Preferences Toggles
  const mandatoryCourses = preferences.mandatoryCourses || [];
  const mandatoryCourseKeys = preferences.mandatoryCourseKeys || [];
  const isGroupMandatory = (group: typeof savedCourseGroups[number]) => {
    const key = group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName);
    return mandatoryCourseKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase());
  };

  const handleToggleMandatoryCourse = (group: typeof savedCourseGroups[number]) => {
    const key = group.courseKey || getCourseIdentityKey(group.courseCode, group.courseName);
    const isCurrentlyChecked = mandatoryCourseKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const nextKeys = isCurrentlyChecked
      ? mandatoryCourseKeys.filter((candidate) => candidate.toLowerCase() !== key.toLowerCase())
      : [...mandatoryCourseKeys, key];
    const dedupedKeys = Array.from(new Map(nextKeys.map((candidate) => [candidate.toLowerCase(), candidate] as const)).values());
    const nextLabels = dedupedKeys
      .map((candidate) => savedCourseGroups.find((g) => (g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName)).toLowerCase() === candidate.toLowerCase())?.courseName || '')
      .filter(Boolean);
    onUpdatePreferences({ ...preferences, mandatoryCourses: nextLabels, mandatoryCourseKeys: dedupedKeys });
  };

  const handleSelectAllMandatory = () => {
    const allKeys = savedCourseGroups.map((g) => g.courseKey || getCourseIdentityKey(g.courseCode, g.courseName));
    const allNames = savedCourseGroups.map((g) => g.courseName);
    onUpdatePreferences({ ...preferences, mandatoryCourses: allNames, mandatoryCourseKeys: allKeys });
  };

  const handleClearAllMandatory = () => {
    onUpdatePreferences({
      ...preferences,
      mandatoryCourses: [],
      mandatoryCourseKeys: [],
    });
  };

  const handleToggleDayBucket = (dayCount: number) => {
    const current = preferences.dayBuckets?.length ? preferences.dayBuckets : [1,2,3,4,5,6,7];
    if (current.includes(dayCount) && current.length === 1) return;
    const next = current.includes(dayCount) ? current.filter((d) => d !== dayCount) : [...current, dayCount].sort((a,b) => a-b);
    onUpdatePreferences({ ...preferences, dayBuckets: next });
  };

  const handleTimePreferenceChange = (field: 'earliestStartTime' | 'latestEndTime', value: string) => {
    onUpdatePreferences({ ...preferences, [field]: value ? value : 'ANY' });
  };

  const handleCreditRangeToggle = (enabled: boolean) => {
    onUpdatePreferences({ ...preferences, useCreditRange: enabled });
  };

  const handleCreditRangeValue = (field: 'minCredits' | 'maxCredits', value: string) => {
    if (field === 'minCredits') setMinCreditsStr(value); else setMaxCreditsStr(value);
    if (!value.trim()) {
      onUpdatePreferences({ ...preferences, [field]: undefined });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > TARGET_CREDITS_MAX) return;
    const other = field === 'minCredits' ? preferences.maxCredits : preferences.minCredits;
    if (other != null && ((field === 'minCredits' && parsed > other) || (field === 'maxCredits' && parsed < other))) return;
    onUpdatePreferences({ ...preferences, [field]: parsed });
  };

  const handleToggleFreeDay = (day: DayOfWeek) => {
    const current = preferences.freeDays || [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    onUpdatePreferences({
      ...preferences,
      freeDays: next,
    });
  };

  const handleResetTimingPreferences = () => {
    onUpdatePreferences({
      ...preferences,
      freeDays: [],
      earliestStartTime: 'ANY',
      latestEndTime: 'ANY',
      maxDays: null,
      preferCompactDays: false,
    });
  };

  const hasAnyTimingPrefs = Boolean(
    (preferences.freeDays && preferences.freeDays.length > 0) ||
      (preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY') ||
      (preferences.latestEndTime && preferences.latestEndTime !== 'ANY') ||
      (preferences.maxDays !== null && preferences.maxDays !== undefined) ||
      preferences.preferCompactDays
  );

  const DAY_LABELS: Record<DayOfWeek, string> = {
    SAT: 'Sat', SUN: 'Sun', MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri',
  };

  const updateManualForm = (formIndex: number, patch: Partial<ManualFormState>) => {
    setManualError(null);
    setManualForms((prev) => prev.map((form, idx) => idx === formIndex ? { ...form, ...patch } : form));
  };

  const updateManualMeeting = (formIndex: number, sessionIndex: number, patch: Partial<ManualMeetingRow>) => {
    setManualError(null);
    setManualForms((prev) => prev.map((form, idx) => idx === formIndex
      ? { ...form, sessions: form.sessions.map((session, sIdx) => sIdx === sessionIndex ? { ...session, ...patch } : session) }
      : form
    ));
  };

  const hasResponsivePreferences = (preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY') ||
    (preferences.latestEndTime && preferences.latestEndTime !== 'ANY') ||
    (preferences.maxDays !== null && preferences.maxDays !== undefined) ||
    Boolean(preferences.preferCompactDays) || (preferences.freeDays?.length ?? 0) > 0;

  const scrollToAddCoursesArea = useCallback(() => {
    const doScroll = () => {
      const target =
        document.getElementById('responsive-choice-section') ||
        document.getElementById('responsive-add-title') ||
        document.getElementById('upload-dropzone') ||
        document.getElementById('step-add-courses-container');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };
    if (!doScroll()) {
      requestAnimationFrame(doScroll);
    }
    setTimeout(doScroll, 60);
    setTimeout(doScroll, 160);
  }, []);

  const handleBackFromWorkflow = useCallback(() => {
    const nextPanel: WorkflowPanel = savedCourseGroups.length > 0 ? 'preferences' : 'start';
    setWorkflowPanel(nextPanel);
    if (nextPanel === 'start') {
      scrollToAddCoursesArea();
    }
  }, [savedCourseGroups.length, setWorkflowPanel, scrollToAddCoursesArea]);

  const handleBackHome = useCallback(() => {
    onGoHome?.();
    if (savedCourseGroups.length === 0) {
      scrollToAddCoursesArea();
    }
  }, [onGoHome, savedCourseGroups.length, scrollToAddCoursesArea]);

  const responsiveCourseBuilder = (
    <div className="responsive-product-shell" aria-label="Gadwal course builder">
      {onGoHome && responsivePanel !== 'start' && (
        <div className="mb-4">
          <button
            type="button"
            id="builder-btn-back-home"
            onClick={handleBackHome}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-text-secondary hover:text-ink transition-colors cursor-pointer py-1 px-2 -ml-2 rounded-xs"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Home</span>
          </button>
        </div>
      )}
      {responsivePanel !== 'start' && (
        <div className="responsive-context">
          <div className="responsive-context-row">
            <div>
              <h1>
                {savedCourseGroups.length > 0
                  ? 'Build a week that works for you.'
                  : responsivePanel === 'manual'
                    ? 'Add a course.'
                    : 'Add your screenshots.'}
              </h1>
              <p>
                {savedCourseGroups.length > 0
                  ? 'Your courses are in. Choose what matters for your week.'
                  : responsivePanel === 'manual'
                    ? 'Enter the details, then add the next course.'
                    : 'Upload your schedule screenshots. We’ll read the course options for you.'}
              </p>
            </div>
            {savedCourseGroups.length > 0 && (
              <span className="responsive-count-badge" aria-label={`${savedCourseGroups.length} courses added`}>
                {savedCourseGroups.length}
              </span>
            )}
          </div>
        </div>
      )}

      {(!isOnline || !ocrServiceAvailable) && (
        <div className="responsive-inline-note" role="status">
          <span className="responsive-note-dot" aria-hidden="true" />
          <span>
            {!isOnline
              ? 'You’re offline. You can still enter courses and build a schedule.'
              : 'Screenshot reading is unavailable right now. Enter the courses yourself instead.'}
          </span>
        </div>
      )}

      {savedCourseGroups.length === 0 && responsivePanel === 'start' && (
        <>
        <section className="responsive-primary-choice" id="responsive-choice-section" aria-labelledby="responsive-add-title">
          <div className="responsive-section-intro">
            <span className="responsive-step-label">1 · ADD COURSES</span>
            <h2 id="responsive-add-title">How do you want to add your courses?</h2>
          </div>

          <button
            type="button"
            className="responsive-big-choice"
            onClick={() => {
              setActiveTab('screenshot');
              setWorkflowPanel('screenshots');
            }}
            disabled={isUploading}
          >
            <span>
              <span className="flex items-center gap-2 flex-wrap">
                <strong>Use screenshots</strong>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider bg-amber-50 text-amber-900 border border-amber-300 whitespace-nowrap">
                  <Zap className="w-3 h-3 text-amber-600 fill-amber-500" aria-hidden="true" />
                  FAST
                </span>
              </span>
              <small>Best when you want it fast.</small>
            </span>
            <span className="flex items-center gap-2">
              <span className="responsive-cta-pill hidden sm:inline-flex">Upload screenshots <ArrowRight className="w-3.5 h-3.5" /></span>
              <ChevronRight className="w-5 h-5 sm:hidden" aria-hidden="true" />
            </span>
          </button>

          <button
            type="button"
            className="responsive-big-choice"
            onClick={() => {
              setActiveTab('manual');
              setWorkflowPanel('manual');
              setResponsiveManualOpenIndex(0);
            }}
          >
            <span>
              <strong>Enter courses yourself</strong>
              <small>Useful when a screenshot missed a course or you want to add one yourself.</small>
            </span>
            <span className="flex items-center gap-2">
              <span className="responsive-cta-pill responsive-cta-pill-secondary hidden sm:inline-flex">Type details <ArrowRight className="w-3.5 h-3.5" /></span>
              <ChevronRight className="w-5 h-5 sm:hidden" aria-hidden="true" />
            </span>
          </button>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button type="button" id="start-demo-link" className="responsive-help-link cursor-pointer" onClick={onOpenDemo}>
              <ImageIcon className="w-4 h-4 text-brand-green shrink-0" />
              <span>See screenshot guide</span>
            </button>
            <button type="button" id="start-how-it-works-link" className="responsive-help-link responsive-help-link-secondary cursor-pointer" onClick={onOpenHowItWorks}>
              <Sparkles className="w-4 h-4 text-ink shrink-0" />
              <span>See how it works</span>
            </button>
            <button type="button" className="responsive-help-link responsive-help-link-secondary cursor-pointer" onClick={(event) => { screenshotTipsTriggerRef.current = event.currentTarget; setIsScreenshotTipsOpen(true); }}>
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Screenshot tips</span>
            </button>
          </div>
        </section>
        </>
      )}

      {responsivePanel === 'screenshots' && (
        <section className="responsive-focus-panel" aria-labelledby="responsive-screenshots-title">
          <div className="responsive-panel-top">
            <button type="button" className="responsive-back-link" onClick={handleBackFromWorkflow}>
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(event) => { screenshotTipsTriggerRef.current = event.currentTarget; setIsScreenshotTipsOpen(true); }}
                className="responsive-info-pill"
                title="View screenshot formatting tips"
              >
                <Info className="w-4 h-4 text-blue-600" />
                <span>Tips & formats</span>
              </button>
              <span className="responsive-step-label">1 · SCREENSHOTS</span>
            </div>
          </div>

          <div
            className={`responsive-upload-hero${isDragActive ? ' is-drag-active' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragActive(false); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragActive(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void handleFileSelect(e.dataTransfer.files);
              }
            }}
          >
            <div className="responsive-upload-icon"><ImageIcon className="w-6 h-6" /></div>
            <h2 id="responsive-screenshots-title">Add your screenshots</h2>
            <p>Use screenshots that clearly show course names, sections, days, and times. You can drag them in, paste them, or choose files.</p>
            <p id="screenshot-upload-help" className="sr-only">PNG, JPEG, or WebP images. Multiple screenshots are allowed.</p>
            <button
              type="button"
              id="choose-screenshots-btn"
              className="responsive-primary-button responsive-wide-button"
              onClick={handleTriggerFileInput}
              disabled={isUploading || isPreparingFiles}
              aria-describedby="screenshot-upload-help"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>{uploadedFiles.length > 0 ? 'Add more screenshots' : 'Choose screenshots'}</span>
            </button>
            <div className="responsive-upload-secondary-actions flex flex-wrap items-center justify-center gap-3 mt-3">
              <button type="button" id="upload-demo-link" className="responsive-help-link cursor-pointer" onClick={onOpenDemo}>
                <ImageIcon className="w-4 h-4 text-brand-green shrink-0" />
                <span>See screenshot guide</span>
              </button>
              <button type="button" className="responsive-help-link responsive-help-link-secondary cursor-pointer" onClick={(event) => { screenshotTipsTriggerRef.current = event.currentTarget; setIsScreenshotTipsOpen(true); }}>
                <HelpCircle className="w-4 h-4 text-text-secondary shrink-0" />
                <span>Formatting tips</span>
              </button>
            </div>
          </div>

          {isUploading && uploadProgress && (
            <WorkflowStatus kind="loading" compact title={uploadProgress.stage} description={uploadProgress.detail} />
          )}

          {ocrError && (
            <WorkflowStatus
              kind={ocrErrorMeta?.retryable ? 'error' : 'warning'}
              title={ocrErrorMeta?.retryable ? 'Screenshot reading needs another try.' : 'Screenshot reading needs attention.'}
              description={ocrError}
              actionLabel={ocrErrorMeta?.retryable ? (ocrRetryAfterSeconds > 0 ? `Retry in ${ocrRetryAfterSeconds}s` : 'Retry screenshots') : undefined}
              onAction={ocrErrorMeta?.retryable ? handleRetryFailed : undefined}
              actionDisabled={ocrRetryAfterSeconds > 0 || isUploading}
            />
          )}

          {ocrNotice && (
            <div className="responsive-upload-message responsive-upload-message-notice" role="status" aria-live="polite">
              <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{ocrNotice}</span>
            </div>
          )}

          {offlineNotice && (
            <div className="responsive-upload-message responsive-upload-message-notice" role="status" aria-live="polite">
              <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{offlineNotice}</span>
            </div>
          )}
          {lastWorkflowAction && <div className="responsive-upload-message responsive-upload-message-notice" role="status" aria-live="polite"><Info className="w-4 h-4 shrink-0" aria-hidden="true" /><span>{lastWorkflowAction}</span></div>}

          {uploadedFiles.length > 0 && (() => {
            const readyCount = uploadedFiles.filter((f) => f.status === 'success' || f.status === 'corpus-ready').length;
            const failedCount = uploadedFiles.filter((f) => f.status === 'failed').length;
            const processingCount = uploadedFiles.filter((f) => f.status === 'processing').length;
            return <div className="responsive-upload-aggregate" role="status" aria-live="polite">
              <strong>{readyCount} ready</strong><span>·</span><strong>{failedCount} need attention</strong><span>·</span><strong>{processingCount} processing</strong>
            </div>;
          })()}

          {uploadedFiles.length > 0 && (
            <div className="responsive-file-stack">
              {uploadedFiles.length > 8 ? (
                <details className="responsive-file-details">
                  <summary className="responsive-file-heading"><strong>{uploadedFiles.length} screenshots added</strong><span>Show uploaded files</span></summary>
                  <div className="responsive-file-stack-inner">
                    {uploadedFiles.map((item) => (
                      <div key={item.id} className="responsive-file-row">
                        <div className="responsive-file-thumb"><img src={item.preview} alt="" /></div>
                        <div className="responsive-file-copy"><strong>{item.name}</strong><span className={`responsive-file-status${item.status === 'failed' ? ' is-error' : item.status === 'success' || item.status === 'corpus-ready' ? ' is-ready' : ''}`}>{item.status === 'corpus-ready' ? 'Included in OCR corpus' : item.status === 'success' ? 'Ready' : item.status === 'processing' ? 'Extracting...' : item.status === 'failed' ? 'Couldn’t read this screenshot' : 'Waiting to be read'}</span>{item.status === 'failed' && item.errorMessage && <span className="responsive-file-error">{item.errorMessage}</span>}</div>
                        <button type="button" className="responsive-icon-button" onClick={() => handleRemoveFile(item.id)} disabled={item.status === 'processing' || isPreparingFiles} aria-label={`Remove ${item.name}`}><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <>
                  <div className="responsive-file-heading"><strong>{uploadedFiles.length} screenshot{uploadedFiles.length === 1 ? '' : 's'} added</strong></div>
                  {uploadedFiles.map((item) => (
                    <div key={item.id} className="responsive-file-row">
                      <div className="responsive-file-thumb"><img src={item.preview} alt="" /></div>
                      <div className="responsive-file-copy"><strong>{item.name}</strong><span className={`responsive-file-status${item.status === 'failed' ? ' is-error' : item.status === 'success' || item.status === 'corpus-ready' ? ' is-ready' : ''}`}>{item.status === 'corpus-ready' ? 'Included in OCR corpus' : item.status === 'success' ? 'Ready' : item.status === 'processing' ? 'Extracting...' : item.status === 'failed' ? 'Couldn’t read this screenshot' : 'Waiting to be read'}</span>{item.status === 'failed' && item.errorMessage && <span className="responsive-file-error">{item.errorMessage}</span>}</div>
                      <button type="button" className="responsive-icon-button" onClick={() => handleRemoveFile(item.id)} disabled={item.status === 'processing' || isPreparingFiles} aria-label={`Remove ${item.name}`}><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {uploadedFiles.length > 0 && (
            <button
              type="button"
              className="responsive-secondary-button responsive-wide-button"
              onClick={handleClearAllFiles}
              disabled={isPreparingFiles ? false : (isUploading || ocrProcessingRef.current)}
            >
              Remove all screenshots
            </button>
          )}

          {uploadProgress && (
            <div className="responsive-progress-card" aria-live="polite">
              <div><strong>{uploadProgress.stage}</strong></div>
              <div className="text-xs text-text-secondary mb-2">{uploadProgress.detail}</div>
              <div className="responsive-progress-track"><div className="responsive-progress-indeterminate" /></div>
            </div>
          )}

          {pendingParsedSections && pendingParsedSections.length > 0 && (
            <div className="responsive-found-card" role="status">
              <div>
                <strong>We found {pendingCourseGroups.length} course{pendingCourseGroups.length === 1 ? '' : 's'}.</strong>
                <span>Check the course details before adding them.</span>
              </div>
              <button type="button" className="responsive-primary-button responsive-wide-button" onClick={() => setIsReviewModalOpen(true)}>
                <span>Review the courses ({pendingCourseGroups.length})</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <button type="button" className="responsive-secondary-button responsive-wide-button" onClick={() => { setActiveTab('manual'); setWorkflowPanel('manual'); }}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Enter courses yourself instead</span>
          </button>
        </section>
      )}

      {responsivePanel === 'manual' && (
        <section className="responsive-focus-panel" aria-labelledby="responsive-manual-title">
          <div className="responsive-panel-top">
            <button type="button" className="responsive-back-link" onClick={handleBackFromWorkflow}><ArrowLeft className="w-4 h-4" /> Back</button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(event) => { manualTipsTriggerRef.current = event.currentTarget; setIsManualTipsOpen(true); }}
                className="responsive-info-pill"
                title="View manual course entry tips and examples"
              >
                <HelpCircle className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>Tips & examples</span>
              </button>
              <span className="responsive-step-label">1 · MANUAL ENTRY</span>
            </div>
          </div>
          <div className="responsive-section-intro">
            <h2 id="responsive-manual-title">Add a course</h2>
            <p>Start with the course name, credits, and class time.</p>
          </div>

          <div className="responsive-manual-list">
            {manualForms.map((form, formIndex) => {
              const isOpen = formIndex === responsiveManualOpenIndex;
              return (
                <div key={form.id} className="responsive-manual-shell">
                  <button type="button" className="responsive-manual-collapsed" onClick={() => setResponsiveManualOpenIndex(isOpen ? null : formIndex)} aria-expanded={isOpen} aria-controls={`manual-form-editor-${form.id}`}>
                    <span className="min-w-0 break-words"><strong className="block break-words whitespace-normal">{form.name || `Course ${formIndex + 1}`}</strong><small>{form.name ? `${form.sessions.filter((s) => s.day && s.start && s.end).length} meeting time${form.sessions.filter((s) => s.day && s.start && s.end).length === 1 ? '' : 's'}` : 'Not finished yet'}</small></span>
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {isOpen && (
                    <div id={`manual-form-editor-${form.id}`} className="responsive-manual-editor">
                      <h3 data-manual-editor-heading tabIndex={-1} className="sr-only">Edit {form.name || `Course ${formIndex + 1}`}</h3>
                      <label htmlFor={`manual-field-${form.id}-name`}>Course name</label><input id={`manual-field-${form.id}-name`} value={form.name} onChange={(e) => updateManualForm(formIndex, { name: e.target.value })} autoFocus={formIndex === 0 && !form.name && typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches} placeholder="For example, Calculus I" />

                      <label htmlFor={`manual-field-${form.id}-courseCode`}>Course code *</label><input id={`manual-field-${form.id}-courseCode`} value={form.courseCode} required aria-required="true" onChange={(e) => updateManualForm(formIndex, { courseCode: e.target.value })} placeholder="e.g. ECON 101" aria-invalid={Boolean(form.name.trim() && !form.courseCode.trim())} aria-describedby={!form.courseCode.trim() && form.name.trim() ? `manual-field-${form.id}-courseCode-error` : undefined} />
                      {!form.courseCode.trim() && form.name.trim() && <span id={`manual-field-${form.id}-courseCode-error`} className="sr-only">Course code is required.</span>}

                      <label htmlFor={`manual-field-${form.id}-sectionCode`}>Section code *</label><input id={`manual-field-${form.id}-sectionCode`} value={form.sectionCode} required aria-required="true" onChange={(e) => updateManualForm(formIndex, { sectionCode: e.target.value })} placeholder="e.g. New01" aria-invalid={Boolean(form.name.trim() && !form.sectionCode.trim())} aria-describedby={!form.sectionCode.trim() && form.name.trim() ? `manual-field-${form.id}-sectionCode-error` : undefined} />
                      {!form.sectionCode.trim() && form.name.trim() && <span id={`manual-field-${form.id}-sectionCode-error`} className="sr-only">Section code is required.</span>}

                      <div className="pt-2">
                        <CreditHourSelector
                          label="Credits"
                          value={form.credits}
                          idPrefix={`manual-form-${formIndex}-credits`}
                          onChange={(_, strVal) => updateManualForm(formIndex, { credits: strVal })}
                        />
                      </div>

                      <div className="responsive-meeting-editor">
                        <div className="responsive-editor-heading"><div><strong>When does it meet?</strong><span>Add one class time to start.</span></div></div>
                        {form.sessions.map((session, sessionIndex) => (
                          <div key={session.id} className="responsive-meeting-line">
                            <label htmlFor={`manual-form-${form.id}-session-${sessionIndex}-day`}>Day</label>
                            <select id={`manual-form-${form.id}-session-${sessionIndex}-day`} aria-label={`${form.name || `Course ${formIndex + 1}`} meeting ${sessionIndex + 1} day`} value={session.day} onChange={(e) => updateManualMeeting(formIndex, sessionIndex, { day: e.target.value as DayOfWeek | '' })}>
                              <option value="">Choose a day</option>{ALL_DAYS.map((day) => <option key={day} value={day}>{DAY_LABELS[day]}</option>)}
                            </select>
                            <label htmlFor={`manual-form-${form.id}-session-${sessionIndex}-type`}>Meeting type</label>
                            <select id={`manual-form-${form.id}-session-${sessionIndex}-type`} aria-label={`${form.name || `Course ${formIndex + 1}`} meeting ${sessionIndex + 1} meeting type`} value={isManualMeetingType(session.type) ? session.type : 'Custom'} onChange={(e) => updateManualMeeting(formIndex, sessionIndex, { type: e.target.value as MeetingType, customType: e.target.value === 'Custom' ? session.customType : '' })}>
                              {MANUAL_MEETING_TYPE_OPTIONS.filter((option) => option !== 'Custom').map((option) => <option key={option} value={option}>{option}</option>)}<option value="Custom">Custom</option>
                            </select>
                            {session.type === 'Custom' && <>
                              <label htmlFor={`manual-form-${form.id}-session-${sessionIndex}-custom`}>Custom type</label>
                              <input id={`manual-form-${form.id}-session-${sessionIndex}-custom`} aria-label={`${form.name || `Course ${formIndex + 1}`} meeting ${sessionIndex + 1} custom type`} value={session.customType || ''} onChange={(e) => updateManualMeeting(formIndex, sessionIndex, { customType: e.target.value })} placeholder="Meeting type" />
                            </>}
                            <div className="responsive-time-pair">
                              <label htmlFor={`manual-form-${form.id}-session-${sessionIndex}-start`}>Start</label>
                              <input id={`manual-form-${form.id}-session-${sessionIndex}-start`} aria-label={`${form.name || `Course ${formIndex + 1}`} meeting ${sessionIndex + 1} start time`} type="time" value={session.start} onChange={(e) => updateManualMeeting(formIndex, sessionIndex, { start: e.target.value, rawStart: e.target.value })} />
                              <span className="sr-only">to</span>
                              <label htmlFor={`manual-form-${form.id}-session-${sessionIndex}-end`}>End</label>
                              <input id={`manual-form-${form.id}-session-${sessionIndex}-end`} aria-label={`${form.name || `Course ${formIndex + 1}`} meeting ${sessionIndex + 1} end time`} type="time" value={session.end} onChange={(e) => updateManualMeeting(formIndex, sessionIndex, { end: e.target.value, rawEnd: e.target.value })} />
                            </div>
                            {form.sessions.length > 1 && <button type="button" className="responsive-danger-link min-h-[44px]" aria-label={`Remove meeting ${sessionIndex + 1}`} onClick={() => handleRemoveMeetingRow(formIndex, sessionIndex)}>Remove this meeting</button>}
                          </div>
                        ))}
                        <button type="button" className="responsive-add-line" onClick={() => handleAddMeetingRow(formIndex)}><Plus className="w-4 h-4" aria-hidden="true" /> Add another meeting day</button>
                      </div>

                      {formIndex > 0 && <button type="button" className="responsive-danger-link" onClick={() => handleRemoveManualForm(formIndex)}>Remove course</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {manualError && <div className="responsive-inline-note responsive-error-note" role="alert"><span className="responsive-note-dot" />{manualError}</div>}

          <button
            type="button"
            className="responsive-primary-button responsive-wide-button"
            onClick={() => { if (handleSaveManualSections()) setWorkflowPanel('preferences'); }}
            disabled={!canSaveManualBatch}
          >
            <span>Save course{manualForms.length > 1 ? 's' : ''} & set preferences</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" className="responsive-secondary-button responsive-wide-button" onClick={() => { setManualForms((prev) => [...prev, createEmptyManualForm(String(prev.length + 1))]); setResponsiveManualOpenIndex(manualForms.length); }}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add another course</span>
          </button>
          <div className="flex justify-center pt-2">
            <button
              type="button"
              className="responsive-help-link responsive-help-link-secondary cursor-pointer"
              onClick={() => { setActiveTab('screenshot'); setWorkflowPanel('screenshots'); }}
            >
              <ImageIcon className="w-4 h-4 text-brand-green shrink-0" />
              <span>Have screenshots instead? Use screenshots</span>
            </button>
          </div>
        </section>
      )}

      {savedCourseGroups.length > 0 && responsivePanel === 'preferences' && (
        <>
          <section className="responsive-course-overview mb-6 p-4 sm:p-5 rounded-2xl bg-white border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs" aria-labelledby="responsive-courses-heading">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-mist flex items-center justify-center shrink-0 border border-line">
                <BookOpen className="w-5 h-5 text-ink" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 id="responsive-courses-heading" className="text-base sm:text-lg font-bold text-ink">Your courses</h2>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-mist text-text-secondary border border-line">
                    {savedCourseGroups.length} {savedCourseGroups.length === 1 ? 'course' : 'courses'} · {totalCredits} credits
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
                  All courses and sections are ready.
                </p>
              </div>
            </div>
            <div className="responsive-preference-actions flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                id="btn-add-more-courses"
                className="min-h-[44px] px-4 py-2 bg-ink hover:bg-ink-soft text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-xs"
                onClick={() => setWorkflowPanel('start')}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add more courses</span>
              </button>
              <button
                type="button"
                id="btn-review-courses"
                className="min-h-[44px] px-4 py-2 bg-paper hover:bg-mist text-ink border border-line-strong rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-xs"
                onClick={() => setIsDetailsModalOpen(true)}
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                <span>Review courses</span>
              </button>
            </div>
          </section>

          <SchedulePreferencesPanel
            preferences={preferences}
            onUpdatePreferences={onUpdatePreferences}
            savedCourseGroups={savedCourseGroups}
            targetCreditsStr={targetCreditsStr}
            setTargetCreditsStr={setTargetCreditsStr}
            targetCourseCountStr={targetCourseCountStr}
            setTargetCourseCountStr={setTargetCourseCountStr}
            markUserSetTargetCourseCount={() => { hasUserSetTargetCourseCountRef.current = true; }}
            markUserSetTargetCredits={() => { hasUserSetTargetCreditsRef.current = true; }}
            minCreditsStr={minCreditsStr}
            maxCreditsStr={maxCreditsStr}
            targetCreditsValidation={targetCreditsValidation}
            targetCourseCountValidation={targetCourseCountValidation}
            creditRangeValidation={creditRangeValidation}
            timeWindowValidation={timeWindowValidation}
            unknownCreditCourseCount={unknownCreditCourseCount}
            mandatoryCourseKeys={mandatoryCourseKeys}
            mandatoryCourses={mandatoryCourses}
            isGroupMandatory={isGroupMandatory}
            handleToggleMandatoryCourse={handleToggleMandatoryCourse}
            handleClearAllMandatory={handleClearAllMandatory}
            handleToggleDayBucket={handleToggleDayBucket}
            handleTimePreferenceChange={handleTimePreferenceChange}
            handleCreditRangeToggle={handleCreditRangeToggle}
            handleCreditRangeValue={handleCreditRangeValue}
            handleToggleFreeDay={handleToggleFreeDay}
            handleResetTimingPreferences={handleResetTimingPreferences}
            hasAnyTimingPrefs={hasAnyTimingPrefs}
            formatCourseDisplay={formatCourseDisplay}
            dayLabels={DAY_LABELS}
            onOpenTips={(event) => { preferencesTipsTriggerRef.current = event.currentTarget; setIsPreferencesTipsOpen(true); }}
          />

          {estimateError && <WorkflowStatus kind="warning" compact title="Quick option check unavailable" description={estimateError} />}

          <div className="responsive-preference-summary" aria-live="polite">
            <strong>Built using</strong>
            <span>{preferences.targetCredits != null ? `${preferences.targetCredits} credits` : 'Any credits'}</span>
            <span>· {preferences.targetCourseCount != null ? `${preferences.targetCourseCount} courses` : 'Any course count'}</span>
            <span>· {mandatoryCourseKeys.length} must-take</span>
            {preferences.dayBuckets?.length && preferences.dayBuckets.length < 7 ? <span>· {preferences.dayBuckets.join(', ')} day buckets</span> : null}
            {preferences.maxDays != null && <span>· max {preferences.maxDays} days</span>}
            {preferences.useCreditRange && (preferences.minCredits != null || preferences.maxCredits != null) && <span>· range {preferences.minCredits ?? 0}–{preferences.maxCredits ?? '∞'} credits</span>}
            {preferences.freeDays?.length ? <span>· free: {preferences.freeDays.map((d) => DAY_LABELS[d]).join(', ')}</span> : null}
            {preferences.earliestStartTime && preferences.earliestStartTime !== 'ANY' && <span>· from {preferences.earliestStartTime}</span>}
            {preferences.latestEndTime && preferences.latestEndTime !== 'ANY' && <span>· until {preferences.latestEndTime}</span>}
            {preferences.preferCompactDays && <span>· compact days preferred</span>}
          </div>

          <div className={`responsive-sticky-action${isKeyboardViewportOpen ? ' is-keyboard-open' : ''}`}>
            <div className="responsive-sticky-inner">
              <div><strong>{savedCourseGroups.length} course{savedCourseGroups.length === 1 ? '' : 's'}</strong><span>{unknownCreditCourseCount > 0 ? `${knownCredits} known credits · ${unknownCreditCourseCount} unknown` : `${knownCredits} credits`} · {isEstimating ? 'checking options…' : liveEstimate?.searchCompleteness === 'capped' ? 'estimate capped; ready to search' : 'ready to search'}</span></div>
              {isCalculating ? (
                <button type="button" className="responsive-secondary-button responsive-build-button" onClick={onCancelOptimizer} disabled={!onCancelOptimizer}>
                  <X className="w-4 h-4" /> Cancel search
                </button>
              ) : (
                <button type="button" className="responsive-primary-button responsive-build-button" onClick={onRunOptimizer} disabled={isEstimating || !isPreferencesValid || !liveEstimate}>
                  Find my schedules <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {hasPreviousResults && onViewPreviousResults && <div className="responsive-secondary-navigation"><button type="button" className="responsive-help-link responsive-centered-link" onClick={onViewPreviousResults}>See earlier schedules</button></div>}
        </>
      )}
    </div>
  );

  return (
    <div id="step-add-courses-container" className="responsive-page" data-workflow-phase={workflow.phase}>
      <input
        ref={fileInputRef}
        id="schedule-screenshot-upload-input"
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="opacity-0 fixed pointer-events-none"
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFileSelect(e.target.files);
            e.target.value = '';
          }
        }}
      />
      {responsiveCourseBuilder}

      {/* REVIEW EXTRACTED COURSES MODAL */}
      {isReviewModalOpen && pendingParsedSections && pendingParsedSections.length > 0 && pendingCourseGroups[activeCourseIndex] && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={handleClosePendingModal}
        >
          <div
            ref={pendingModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-courses-modal-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet ocr-review-modal sm:max-w-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="gd-modal-header">
              <div>
                <h2 id="review-courses-modal-title" className="text-lg font-extrabold text-ink">
                  Review the courses we found
                </h2>
                <p className="text-xs font-semibold text-text-secondary mt-0.5">
                  Course {activeCourseIndex + 1} of {pendingCourseGroups.length} • Check details before adding to schedule
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePendingModal}
                aria-label="Close course review"
                className="gd-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner if any */}
            {reviewModalError && (
              <div className="px-5 py-2.5 bg-alert/10 border-b border-alert/20 text-alert text-sm font-semibold flex items-center gap-2 shrink-0" role="alert" aria-live="assertive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reviewModalError}</span>
              </div>
            )}

            {/* Scrollable Course Content */}
            <div ref={reviewScrollContainerRef} className="gd-modal-body p-5 space-y-4">
              {(() => {
                const currentGroup = pendingCourseGroups[activeCourseIndex];
                if (!currentGroup) return null;
                const credits = currentGroup.credits;
                return (
                  <div className="space-y-4">
                    {/* Course Title & Delete Button */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-xs font-bold text-text-secondary uppercase tracking-wider block">
                            Course Name
                          </label>
                          {currentGroup.courseCode && (
                            <span className="px-1.5 py-0.5 text-[11px] font-mono font-bold bg-accent/10 text-accent rounded border border-accent/20 break-all">
                              {currentGroup.courseCode}
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={currentGroup.courseName}
                          onChange={(e) => handleUpdatePendingCourseName(currentGroup.courseName, e.target.value, currentGroup.courseKey)}
                          onBlur={() => {
                            const cleaned = sanitizeCourseNameOnly(currentGroup.courseName);
                            if (cleaned && cleaned !== currentGroup.courseName) {
                              handleUpdatePendingCourseName(currentGroup.courseName, cleaned, currentGroup.courseKey);
                            }
                          }}
                          className="w-full px-3 py-2 bg-white border border-line-strong rounded-lg text-base font-extrabold text-ink focus-visible:ring-2 focus-visible:ring-accent"
                          placeholder="e.g. CS 101"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePendingCourse(currentGroup.courseName, currentGroup.courseKey)}
                        aria-label={`Delete ${currentGroup.courseName}`}
                        className="mt-6 p-2 text-text-muted hover:text-alert min-w-[44px] min-h-[44px] grid place-items-center rounded-lg hover:bg-alert-soft transition cursor-pointer shrink-0"
                        title="Delete course"
                      >
                        <Trash2 className="w-5 h-5" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Credit hours */}
                    <div className="pt-2 border-t border-line">
                      <CreditHourSelector
                        label="Credit Hours"
                        value={credits}
                        idPrefix="review-course-credits"
                        onChange={(val) => {
                          handleUpdateCourseCredits(currentGroup.courseName, val, false, currentGroup.courseKey);
                        }}
                      />
                    </div>

                    {/* Sections & Meetings */}
                    <div className="space-y-3 pt-2 border-t border-line">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                          Sections ({currentGroup.sections.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddPendingSection(currentGroup.courseName, credits, currentGroup.courseKey)}
                          className="text-xs font-bold text-ink hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                          <span>Add another option</span>
                        </button>
                      </div>

                      {currentGroup.sections.map((section, sIdx) => (
                        <div key={`${currentGroup.courseName}-${section.id}-${sIdx}`} className="rounded-xl border border-line p-3.5 space-y-3 bg-paper/30">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-xs font-bold text-text-secondary">Section code:</label>
                              <input
                                type="text"
                                value={section.sectionCode ?? ""}
                                onChange={(e) => handleUpdatePendingSectionId(section, e.target.value)}
                                className="w-28 px-2.5 py-1 bg-white border border-line rounded text-xs font-mono font-bold text-ink"
                                placeholder="e.g. New01"
                              />
                            </div>
                            {currentGroup.sections.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeletePendingSection(section, currentGroup.courseName)}
                                className="text-xs text-text-muted hover:text-alert font-bold p-1 cursor-pointer"
                                title="Delete section"
                              >
                                Delete
                              </button>
                            )}
                          </div>

                          {section.needsReview && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2" role="status">
                              <div className="flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <strong className="text-xs font-extrabold text-amber-900">Review needed</strong>
                                  <ul className="mt-1 space-y-1 text-sm text-amber-900">
                                    {Array.from(new Set((section.reviewReasons || []).map(reviewReasonCode))).map((reason) => (
                                      <li key={reason}>{reviewReasonLabel(reason)}</li>
                                    ))}
                                    {section.incompleteMeetings?.length ? (
                                      <li>{section.incompleteMeetings.length} meeting{section.incompleteMeetings.length === 1 ? '' : 's'} could not be read completely.</li>
                                    ) : null}
                                    {section.conflictingMeetings?.length ? (
                                      <li>{section.conflictingMeetings.length} conflicting meeting observation{section.conflictingMeetings.length === 1 ? '' : 's'} were preserved.</li>
                                    ) : null}
                                    {section.creditHoursConflict?.length ? (
                                      <li>Credit evidence: {section.creditHoursConflict.join(' vs ')}.</li>
                                    ) : null}
                                    {section.sourceImageIndexes?.length ? (
                                      <li>Direct OCR evidence was attributed to screenshot{section.sourceImageIndexes.length === 1 ? '' : 's'} {section.sourceImageIndexes.map((n) => n + 1).join(', ')}.</li>
                                    ) : null}
                                  </ul>
                                  {section.reviewReasons?.some((reason) => REVIEW_ACKNOWLEDGEMENT_CODES.has(reviewReasonCode(reason))) && (
                                    <label className="mt-2 flex items-start gap-2 text-[11px] font-bold text-amber-950 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(section.reviewAcknowledged)}
                                        onChange={() => acknowledgeSectionReview(section.id)}
                                        className="mt-0.5 accent-current"
                                      />
                                      <span>I reviewed this note and accept the extracted value as shown.</span>
                                    </label>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Sessions list */}
                          <div className="space-y-2">
                            {section.sessions.map((sess, sessIdx) => (
                              <div key={sess.id || sessIdx} className="flex flex-wrap items-center gap-2 text-xs">
                                <select
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} day`}
                                  value={sess.day}
                                  onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'day', e.target.value as DayOfWeek)}
                                  className="px-2 py-1 min-h-[44px] bg-white border border-line rounded font-bold text-ink"
                                >
                                  {ALL_DAYS.map((d) => (
                                    <option key={d} value={d}>{DAY_LABELS[d]}</option>
                                  ))}
                                </select>
                                <select
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} meeting type`}
                                  value={REVIEW_MEETING_TYPE_OPTIONS.includes(sess.type) ? sess.type : 'Custom'}
                                  onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'type', e.target.value as MeetingType)}
                                  className="px-2 py-1 min-h-[44px] bg-white border border-line rounded font-bold text-ink"
                                >
                                  {REVIEW_MEETING_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                  <option value="Custom">Custom</option>
                                </select>
                                {sess.type === 'Custom' && (
                                  <input
                                    type="text"
                                    value={sess.customType || ''}
                                    onChange={(e) => handleUpdatePendingMeeting(section, sessIdx, 'customType', e.target.value)}
                                    placeholder="Meeting type"
                                    className="w-32 px-2 py-1 min-h-[44px] bg-white border border-line rounded font-bold text-ink"
                                    aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} custom meeting type`}
                                  />
                                )}
                                <input
                                  type="text"
                                  value={formatTo12Hour(sess.start)}
                                  onChange={(e) => {
                                    const parsed = parseUserTypedTime(e.target.value);
                                    if (parsed) handleUpdatePendingMeeting(section, sessIdx, 'start', parsed);
                                  }}
                                  placeholder="Start"
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} start time`}
                                  className="w-24 px-2 py-1 min-h-[44px] bg-white border border-line rounded font-mono font-bold text-ink text-center"
                                />
                                <span className="text-text-muted">to</span>
                                <input
                                  type="text"
                                  value={formatTo12Hour(sess.end)}
                                  onChange={(e) => {
                                    const parsed = parseUserTypedTime(e.target.value);
                                    if (parsed) handleUpdatePendingMeeting(section, sessIdx, 'end', parsed);
                                  }}
                                  placeholder="End"
                                  aria-label={`${section.name || 'Course'} meeting ${sessIdx + 1} end time`}
                                  className="w-24 px-2 py-1 min-h-[44px] bg-white border border-line rounded font-mono font-bold text-ink text-center"
                                />
                                {section.sessions.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePendingMeeting(section, sessIdx)}
                                    className="p-1 min-w-[44px] min-h-[44px] grid place-items-center text-text-muted hover:text-alert cursor-pointer rounded"
                                    aria-label={`Remove meeting ${sessIdx + 1}`} title="Remove meeting"
                                  >
                                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => handleAddPendingMeeting(section)}
                              className="text-xs font-bold text-ink hover:underline flex items-center gap-1 mt-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" aria-hidden="true" />
                              <span>Add another meeting day</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer with pagination and Confirm action */}
            <div className="px-5 py-4 border-t border-line bg-paper flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={() => handleNavigateCourse(activeCourseIndex - 1)}
                  disabled={activeCourseIndex <= 0}
                  className="px-3 py-2 min-h-[44px] rounded-lg border border-line-strong font-bold text-xs sm:text-sm text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-mist cursor-pointer"
                >
                  Previous
                </button>
                <span className="text-xs font-bold text-text-secondary px-2">
                  {activeCourseIndex + 1} / {pendingCourseGroups.length}
                </span>
                <button
                  type="button"
                  onClick={() => handleNavigateCourse(activeCourseIndex + 1)}
                  disabled={activeCourseIndex >= pendingCourseGroups.length - 1}
                  className="px-3 py-2 min-h-[44px] rounded-lg border border-line-strong font-bold text-xs sm:text-sm text-ink disabled:opacity-30 disabled:cursor-not-allowed hover:bg-mist cursor-pointer"
                >
                  Next
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDiscardPendingSections}
                  className="flex-1 sm:flex-none px-3 py-2 min-h-[44px] text-xs sm:text-sm font-bold text-alert hover:bg-alert-soft rounded-lg transition cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPendingSections}
                  className="flex-1 sm:flex-none px-5 py-2 min-h-[44px] rounded-xl bg-ink text-white font-extrabold text-xs sm:text-sm hover:bg-ink-soft shadow-sm transition active:scale-98 cursor-pointer"
                >
                  Add all to schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POPUP MODAL FOR ADDED COURSES DETAILS */}
      {isDetailsModalOpen && (
        <div className="gd-modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setIsDetailsModalOpen(false)}>
          <div ref={detailsModalRef} role="dialog" aria-modal="true" aria-labelledby="added-courses-catalog-title" tabIndex={-1} className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col" onClick={(e)=>e.stopPropagation()}>
            <div className="gd-modal-header">
              <div>
                <h2 id="added-courses-catalog-title" className="text-lg font-bold text-ink">Review courses</h2>
                <p className="text-xs text-text-secondary mt-0.5">{savedCourseGroups.length} {savedCourseGroups.length === 1 ? 'course' : 'courses'} · {totalCredits} credits ready</p>
              </div>
              <button type="button" onClick={()=>setIsDetailsModalOpen(false)} aria-label="Close course list" className="min-w-[44px] min-h-[44px] grid place-items-center rounded-lg hover:bg-mist text-text-secondary hover:text-ink cursor-pointer transition"><X className="w-5 h-5"/></button>
            </div>

            {/* Option to add more courses through screenshots or manual */}
            <div className="px-5 py-3.5 bg-mist/50 border-b border-line">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted block mb-2">
                Add more courses
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  id="modal-btn-add-screenshots"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setActiveTab('screenshot');
                    setWorkflowPanel('screenshots');
                  }}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-line-strong hover:border-ink text-ink text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs hover:bg-paper"
                >
                  <Camera className="w-4 h-4 text-text-secondary" />
                  <span>Add screenshots</span>
                </button>
                <button
                  type="button"
                  id="modal-btn-add-manual"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setManualForms((prev) => [...prev, createEmptyManualForm(String(prev.length + 1))]);
                    setResponsiveManualOpenIndex(manualForms.length);
                    setWorkflowPanel('manual');
                  }}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-line-strong hover:border-ink text-ink text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs hover:bg-paper"
                >
                  <Plus className="w-4 h-4 text-text-secondary" aria-hidden="true" />
                  <span>Add manually</span>
                </button>
              </div>
            </div>

            <div className="gd-modal-body p-4 sm:p-5 space-y-3.5">
              {savedCourseGroups.map((group) => {
                const mandatory = isGroupMandatory(group);
                return (
                  <div key={group.courseKey || `${group.courseCode || ''}:${group.courseName}`} className={`rounded-xl border p-4 space-y-3 transition ${mandatory ? 'border-emerald-300 bg-emerald-50/20' : 'border-line bg-white'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Course</span>
                        <h3 className="text-base font-bold text-ink mt-0.5 min-w-0 break-words whitespace-normal">{formatCourseDisplay(group.courseCode, group.courseName)}</h3>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Credits</span>
                        <div className="mt-0.5">
                          <strong className="inline-block px-2.5 py-0.5 rounded text-xs font-bold bg-mist text-ink border border-line">
                            {group.credits == null ? 'Credits need review' : `${group.credits} credits`}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Section details & meeting times */}
                    <div className="pt-2 border-t border-line/60">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted block mb-1.5">
                        {group.sections.length} {group.sections.length === 1 ? 'section' : 'sections'} & times
                      </span>
                      <div className="space-y-1.5">
                        {group.sections.map((section, sIdx) => (
                          <div key={`${group.courseName}-${section.id}-${sIdx}`} className="p-2.5 rounded-lg bg-paper border border-line/60 text-xs">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-bold text-ink">{section.sectionCode || `Section ${sIdx + 1}`}</span>
                              <span className="text-xs text-text-muted">{section.sessions.length} meeting{section.sessions.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {section.sessions.map((session, idx) => (
                                <span key={`${section.id}-${session.day}-${session.start}-${idx}`} className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-line text-[11px] font-medium text-text-secondary">
                                  {session.type || 'Meeting'} · {DAY_LABELS[session.day]} · {formatTo12Hour(session.start)} to {formatTo12Hour(session.end)}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditSection(section, group.courseName)}
                                className="min-h-[34px] px-2.5 py-1 text-[11px] font-bold text-ink bg-white border border-line rounded-lg hover:bg-mist transition cursor-pointer flex items-center gap-1.5"
                                aria-label={`Edit section ${section.sectionCode || section.id}`}
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit section
                              </button>
                              {onDeleteSection && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteSection(section.id, group.courseName)}
                                  className="min-h-[34px] px-2.5 py-1 text-[11px] font-bold text-alert bg-alert-soft border border-alert-line rounded-lg hover:bg-alert/10 transition cursor-pointer flex items-center gap-1.5"
                                  aria-label={`Remove section ${section.sectionCode || section.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove section
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action buttons: Must take toggle, Edit, Remove */}
                    <div className="pt-2 border-t border-line/60 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink">Must take</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={mandatory}
                          onClick={() => handleToggleMandatoryCourse(group)}
                          aria-label={`${mandatory ? 'Remove' : 'Mark'} ${group.courseName} as must take`}
                          className={`min-h-[36px] min-w-[54px] px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
                            mandatory
                              ? 'bg-ink text-white shadow-xs'
                              : 'bg-paper border border-line-strong text-ink hover:bg-mist'
                          }`}
                        >
                          {mandatory ? 'Yes' : 'No'}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {onDeleteCourse && (
                          <button
                            type="button"
                            onClick={() => onDeleteCourse(group.courseName, group.courseKey)}
                            className="min-h-[36px] px-3 py-1 text-xs font-bold text-alert hover:text-alert-strong bg-alert-soft border border-alert-line rounded-lg transition cursor-pointer flex items-center gap-1.5"
                            aria-label={`Remove all sections of ${formatCourseDisplay(group.courseCode, group.courseName)}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Remove course</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setIsDetailsModalOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-6 rounded-xl bg-ink text-white font-bold text-sm cursor-pointer hover:bg-ink-soft transition shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SECTION MODAL */}
      {editingSection && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setEditingSection(null)}
        >
          <div
            ref={editSectionModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-section-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="gd-modal-header">
              <div>
                <h3 id="edit-section-title" className="text-base font-bold text-ink flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  <span>Edit course</span>
                </h3>
                <p className="text-sm text-text-secondary mt-0.5">
                  Use the same course details and class time fields as course entry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                aria-label="Close section editor"
                className="gd-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-left">
              {editingSection.error && (
                <div id="edit-section-error" className="p-3 bg-alert/10 border border-alert/30 text-alert text-sm font-semibold rounded-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{editingSection.error}</span>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="edit-section-course-name" className="text-sm font-bold text-text-secondary block">
                    Course name
                  </label>
                  <input
                    id="edit-section-course-name"
                    type="text"
                    value={editingSection.courseName}
                    aria-invalid={Boolean(editingSection.error && !editingSection.courseName.trim())}
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    onChange={(e) =>
                      setEditingSection((prev) => (prev ? { ...prev, courseName: e.target.value, error: null } : null))
                    }
                    placeholder="e.g. Accounting Information Systems"
                    className="w-full px-3 py-2 bg-white border border-line-strong rounded-sm text-sm sm:text-sm font-semibold text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-section-course-code" className="text-sm font-bold text-text-secondary block">
                    Course code *
                  </label>
                  <input
                    id="edit-section-course-code"
                    type="text"
                    value={editingSection.courseCode}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(editingSection.error && !editingSection.courseCode.trim())}
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    onChange={(e) =>
                      setEditingSection((prev) => (prev ? { ...prev, courseCode: e.target.value, error: null } : null))
                    }
                    placeholder="e.g. ACT 332"
                    className="w-full px-3 py-2 bg-white border border-line-strong rounded-sm text-sm sm:text-sm font-semibold text-ink font-mono focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="edit-section-code" className="text-sm font-bold text-text-secondary block">Section code *</label>
                  <input
                    id="edit-section-code"
                    type="text"
                    value={editingSection.sectionCode}
                    required
                    aria-required="true"
                    aria-invalid={Boolean(editingSection.error && !editingSection.sectionCode.trim())}
                    aria-describedby={editingSection.error ? 'edit-section-error' : undefined}
                    onChange={(e) => setEditingSection((prev) => (prev ? { ...prev, sectionCode: e.target.value, error: null } : null))}
                    placeholder="e.g. New01"
                    className="w-full px-3 py-2 bg-white border border-line-strong rounded-sm text-sm sm:text-sm font-semibold text-ink font-mono focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </div>
              </div>

              {/* Credits with validation */}
              <div className="space-y-1 pt-1">
                <CreditHourSelector
                  label="Credits"
                  required
                  value={editingSection.credits}
                  idPrefix="edit-section-credits"
                  onChange={(_, strVal) => {
                    setEditingSection((prev) => (prev ? { ...prev, credits: strVal, error: null } : null));
                  }}
                />
              </div>

              {/* Meetings */}
              <div className="space-y-2 pt-2 border-t border-line">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-text-secondary uppercase tracking-wider">
                    When does this class meet?
                  </label>
                  <button
                    type="button"
                    onClick={handleAddEditMeeting}
                    className="text-sm font-bold text-ink hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    <span>Add another meeting day</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {editingSection.sessions.map((sess, idx) => {
                    const isTimeOrderInvalid = Boolean(
                      sess.start && sess.end && timeToMinutes(sess.start) >= timeToMinutes(sess.end)
                    );

                    return (
                      <div
                        key={sess.id}
                        className={`bg-paper/40 p-2.5 sm:p-3 border rounded-sm space-y-2 ${
                          isTimeOrderInvalid ? 'border-alert/70' : 'border-line'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2">
                          {/* On mobile (<sm), Row 1: Day selector, Type selector, and delete button */}
                          <div className="flex items-center justify-between gap-2 sm:contents">
                            <select
                              aria-label={`Editing session ${idx + 1} day`}
                              value={sess.day}
                              onChange={(e) => {
                                const val = e.target.value as DayOfWeek;
                                setEditingSection((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        sessions: prev.sessions.map((s, i) => (i === idx ? { ...s, day: val } : s)),
                                        error: null,
                                      }
                                    : null
                                );
                              }}
                              className="flex-1 sm:flex-none px-2.5 py-1.5 min-h-[44px] bg-white border border-line rounded-sm text-sm font-bold text-ink focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              {ALL_DAYS.map((d) => (
                                <option key={d} value={d}>
                                  {DAY_LABELS[d]}
                                </option>
                              ))}
                            </select>

                            <select
                              aria-label={`Editing session ${idx + 1} type`}
                              value={isManualMeetingType(sess.type) ? sess.type : 'Custom'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingSection((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        sessions: prev.sessions.map((s, i) =>
                                          i === idx
                                            ? {
                                                ...s,
                                                type: val as MeetingType,
                                                customType: val === 'Custom' ? (s.customType || '') : '',
                                              }
                                            : s
                                        ),
                                        error: null,
                                      }
                                    : null
                                );
                              }}
                              className="flex-1 sm:flex-none px-2.5 py-1.5 min-h-[44px] bg-white border border-line rounded-sm text-sm font-bold text-ink"
                            >
                              {MANUAL_MEETING_TYPE_OPTIONS.filter((option) => option !== 'Custom').map((option) => <option key={option} value={option}>{option}</option>)}
                              <option value="Custom">Custom</option>
                            </select>
                            {sess.type === 'Custom' && (
                              <input
                                type="text"
                                value={sess.customType || ''}
                                onChange={(e) => setEditingSection((prev) => prev ? { ...prev, sessions: prev.sessions.map((s, i) => i === idx ? { ...s, customType: e.target.value } : s) } : null)}
                                placeholder="Meeting type"
                                className="flex-1 sm:flex-none px-2.5 py-1.5 min-h-[44px] bg-white border border-line rounded-sm text-sm font-bold text-ink"
                              />
                            )}

                            {editingSection.sessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveEditMeeting(idx)}
                                aria-label={`Remove session ${idx + 1}`}
                                className="sm:hidden p-2 text-text-muted hover:text-alert min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer rounded-sm hover:bg-alert-soft"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* On mobile (<sm), Row 2: Start time + "to" + End time */}
                          <div className="flex items-center gap-1.5 w-full sm:w-auto">
                            <input
                              type="time"
                              value={sess.start}
                              onChange={(e) => {
                                const value = e.target.value;
                                setEditingSection((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        sessions: prev.sessions.map((s, i) => i === idx ? { ...s, start: value, rawStart: value } : s),
                                        error: null,
                                      }
                                    : null
                                );
                              }}
                              aria-label={`Editing session ${idx + 1} start time`}
                              className="flex-1 sm:flex-none sm:w-28 px-2.5 py-1.5 min-h-[44px] bg-white border border-line-strong rounded-sm text-sm font-mono font-semibold text-ink text-center sm:text-left"
                            />
                            <span className="text-text-muted text-sm shrink-0 px-0.5">to</span>
                            <input
                              type="time"
                              value={sess.end}
                              onChange={(e) => {
                                const value = e.target.value;
                                setEditingSection((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        sessions: prev.sessions.map((s, i) => i === idx ? { ...s, end: value, rawEnd: value } : s),
                                        error: null,
                                      }
                                    : null
                                );
                              }}
                              aria-label={`Editing session ${idx + 1} end time`}
                              className="flex-1 sm:flex-none sm:w-28 px-2.5 py-1.5 min-h-[44px] bg-white border border-line-strong rounded-sm text-sm font-mono font-semibold text-ink text-center sm:text-left"
                            />
                            {editingSection.sessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveEditMeeting(idx)}
                                aria-label={`Remove session ${idx + 1}`}
                                className="hidden sm:flex p-1.5 text-text-muted hover:text-alert min-w-[44px] min-h-[44px] items-center justify-center ml-auto cursor-pointer rounded-sm hover:bg-alert-soft"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>

                        {isTimeOrderInvalid && (
                          <div className="flex items-center gap-1.5 text-sm font-bold text-alert pt-0.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>End time must be later than start time.</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                className="px-4 py-2 border border-line-strong hover:border-ink rounded-md text-sm font-bold text-ink cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-save-edit-section"
                onClick={handleSaveEditSection}
                disabled={Boolean(
                  editingSection.sessions.some(
                    (s) => s.start && s.end && timeToMinutes(s.start) >= timeToMinutes(s.end)
                  )
                )}
                aria-label="Save changes"
                className="min-h-[44px] px-5 py-2.5 bg-ink hover:bg-ink-soft text-white rounded-md text-sm font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
      {isAddedSuccessPopupOpen && (
        <div className="gd-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={closeAddedSuccessPopup}>
          <div
            ref={successPopupRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-added-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-compact text-ink p-6 text-center"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3.5 h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 grid place-items-center">
              <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
            </div>
            <h2 id="course-added-title" className="text-xl font-bold text-ink">{addedCoursesCount === 1 ? 'Course added' : 'Courses added'}</h2>
            <p className="mt-1.5 text-sm text-text-secondary">Your courses are ready. Now choose what matters for your week.</p>
            {(skippedDuplicatesCount > 0 || creditsAdjustedCount > 0) && (
              <p className="mt-2 text-xs text-text-muted">
                {skippedDuplicatesCount > 0 ? `${skippedDuplicatesCount} duplicate ${skippedDuplicatesCount === 1 ? 'course was' : 'courses were'} skipped. ` : ''}
                {creditsAdjustedCount > 0 ? `${creditsAdjustedCount} credit ${creditsAdjustedCount === 1 ? 'value was' : 'values were'} adjusted.` : ''}
              </p>
            )}
            <button type="button" className="mt-5 w-full min-h-[46px] rounded-xl bg-ink hover:bg-ink-soft text-white px-4 text-sm font-bold transition shadow-sm cursor-pointer" onClick={closeAddedSuccessPopup}>
              Choose what matters next
            </button>
          </div>
        </div>
      )}

      <ConfirmResetModal
        open={isClearScreenshotsConfirmOpen}
        onCancel={() => setIsClearScreenshotsConfirmOpen(false)}
        onConfirm={() => {
          setIsClearScreenshotsConfirmOpen(false);
          clearAllFilesNow();
        }}
        title="Clear all screenshots?"
        description="This will stop the current screenshot reading and remove the selected screenshots. Your saved courses will stay here."
        confirmLabel="Clear screenshots"
      />

      {/* SCREENSHOT TIPS & GUIDELINES MODAL */}
      {isScreenshotTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsScreenshotTipsOpen(false)}
        >
          <div
            ref={screenshotTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="screenshot-tips-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="screenshot-tips-title" className="text-base sm:text-lg font-black text-ink">
                    Screenshot guidelines & tips
                  </h2>
                  <p className="text-xs text-text-secondary">How to get clean, accurate course extraction</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScreenshotTipsOpen(false)}
                aria-label="Close screenshot tips"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-xs sm:text-sm text-text-secondary leading-relaxed">
              <div className="p-3 bg-paper rounded-xl border border-line space-y-2">
                <strong className="text-ink font-bold block text-sm">What should be visible in the screenshot?</strong>
                <ul className="space-y-1.5 list-disc pl-4 text-ink-soft">
                  <li>Course code and name (for example, CS101, Intro to Programming)</li>
                  <li>Section code or section number (for example, 01, Sec 2, Lab A)</li>
                  <li>Days of the week (for example, Mon, Wed or U T R)</li>
                  <li>Start and end times (for example, 10:00 AM to 11:30 AM)</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-1">
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-800 text-xs">
                    <Check className="w-3.5 h-3.5 text-emerald-600" /> What works best
                  </span>
                  <p className="text-[11px] text-emerald-950">Full table view, high zoom, crisp text, desktop portals or full phone screens.</p>
                </div>
                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1">
                  <span className="inline-flex items-center gap-1 font-bold text-amber-800 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Avoid
                  </span>
                  <p className="text-[11px] text-amber-950">Cropped edges cutting off times, extreme blur, or low-contrast photos of physical screens.</p>
                </div>
              </div>

              <div className="p-3 bg-mist rounded-xl border border-line flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-[11px] text-text-secondary">
                  <strong>How screenshot processing works:</strong> Your selected screenshots are uploaded to Gadwal’s OCR server and processed by its configured AI provider to read course information. Review data is kept locally on your device while you check the results. Avoid uploading screenshots containing information you do not want processed.
                </p>
              </div>
            </div>

            <p id="screenshot-upload-help-modal" className="sr-only">Opens the file picker for PNG, JPEG, or WebP images. Multiple screenshots are allowed.</p>
            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => {
                  setIsScreenshotTipsOpen(false);
                  onOpenDemo?.(screenshotTipsTriggerRef.current);
                }}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-line font-bold text-xs sm:text-sm text-ink hover:bg-paper cursor-pointer"
              >
                See screenshot guide
              </button>
              <button
                type="button"
                aria-describedby="screenshot-upload-help-modal"
                onClick={() => {
                  setIsScreenshotTipsOpen(false);
                  handleTriggerFileInput();
                }}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <ImageIcon className="w-4 h-4" />
                <span>Choose screenshots</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANUAL ENTRY TIPS MODAL */}
      {isManualTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsManualTipsOpen(false)}
        >
          <div
            ref={manualTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-tips-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <BookOpen className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="manual-tips-title" className="text-base sm:text-lg font-black text-ink">
                    Manual course entry guide
                  </h2>
                  <p className="text-xs text-text-secondary">Tips for adding course options and meeting times</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManualTipsOpen(false)}
                aria-label="Close manual entry guide"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-xs sm:text-sm text-text-secondary leading-relaxed">
              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Course with multiple meeting days</strong>
                <p className="text-xs text-ink-soft">
                  If a course meets on Monday and Wednesday at 10:00 AM, click <strong>"Add another meeting day"</strong> to add both days under the same course.
                </p>
              </div>

              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Adding different sections of the same course</strong>
                <p className="text-xs text-ink-soft">
                  Give them the same course name (for example, "Calculus I") with different codes (for example, "Sec 1" vs "Sec 2"). Gadwal will pick the section that gives you the best schedule with the least gap time.
                </p>
              </div>

              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Lectures and Labs</strong>
                <p className="text-xs text-ink-soft">
                  Use the <strong>Meeting type</strong> selector to mark lectures, recitations, sections, or labs.
                </p>
              </div>
            </div>

            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setIsManualTipsOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer"
              >
                Got it, close guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PREFERENCES TIPS MODAL */}
      {isPreferencesTipsOpen && (
        <div
          className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={() => setIsPreferencesTipsOpen(false)}
        >
          <div
            ref={preferencesTipsModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-tips-title"
            tabIndex={-1}
            className="gd-modal-shell gd-modal-sheet sm:max-w-xl flex flex-col text-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gd-modal-header">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <h2 id="preferences-tips-title" className="text-base sm:text-lg font-black text-ink">
                    Schedule preferences explained
                  </h2>
                  <p className="text-xs text-text-secondary">How Gadwal personalizes your weekly layout</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPreferencesTipsOpen(false)}
                aria-label="Close preferences guide"
                className="gd-modal-close"
              >
                <X className="w-5 h-5 text-text-secondary" />
              </button>
            </div>

            <div className="gd-modal-body p-4 sm:p-6 space-y-4 text-xs sm:text-sm text-text-secondary leading-relaxed">
              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Target credits vs Target courses</strong>
                <p className="text-xs text-ink-soft">
                  Set target credits if your courses have varying credits (for example, 3-credit lectures vs 1-credit labs). Set target courses if you want an exact number of classes.
                </p>
              </div>

              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Must-take courses</strong>
                <p className="text-xs text-ink-soft">
                  Mark courses you definitely need this term (like prerequisites or graduation requirements). Gadwal guarantees they are included in every generated schedule.
                </p>
              </div>

              <div className="p-3 bg-paper rounded-xl border border-line space-y-1">
                <strong className="text-ink font-bold block text-sm">Less gap time first</strong>
                <p className="text-xs text-ink-soft">
                  Gadwal sorts valid schedules by least total gap time so you do not waste empty hours on campus.
                </p>
              </div>
            </div>

            <div className="gd-modal-footer gd-modal-action-row">
              <button
                type="button"
                onClick={() => setIsPreferencesTipsOpen(false)}
                className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-xs sm:text-sm hover:bg-ink-soft cursor-pointer"
              >
                Got it, build my schedule
              </button>
            </div>
          </div>
        </div>
      )}
  </div>
  );
});
