/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useReducer, useCallback } from 'react';
import { AlertCircle, Compass } from 'lucide-react';
import { AppStep, OptimizerOutput, SchedulePreferences, Section } from './types';
import { Header } from './components/Header';
import {
  STORAGE_KEY_SECTIONS, STORAGE_KEY_PREFS, STORAGE_KEY_OPTIMIZER, STORAGE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION,
  LEGACY_STORAGE_KEY_SECTIONS, LEGACY_STORAGE_KEY_PREFS, DEFAULT_PREFERENCES,
  readSavedOptimizerOutput, readSavedSections, readSavedPreferences, normalizePathname, CURRENT_RESULT_CONTRACT_VERSION, saveCurrentStep, readSavedCurrentStep, clearAllPersistedAppData, readFavoriteSignatures, saveFavoriteSignatures, migrateSnapshot,

} from './app/persistence';
import { courseBuilderWorkflowReducer, initialCourseBuilderWorkflow, reconcileCourseBuilderWorkflow } from './features/courseBuilder/workflow';
import { HeroBanner } from './components/HeroBanner';
import { StepAddCourses, WorkflowPanel } from './components/StepAddCourses';
import { ConfirmResetModal } from './components/ConfirmResetModal';
import { cancelOptimizerOwner, disposeOptimizerWorker, runOptimizerAsyncCancellable } from './utils/optimizerWorkerClient';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  normalizeCourseName,
  getCourseIdentityKey,
  buildOptimizerCourseMap,
  deduplicateSections,
  computeInputsSignature,
  getInputsChangeSummary,
  canonicalizeSectionIdentity,
  computeSectionsSignature,
  areSchedulePreferencesEqual,
} from './utils/courseUtils';
import { safeStorage, createStorageEnvelope } from './utils/safeStorage';
import { sanitizeSectionsSnapshot, sanitizePreferencesSnapshot } from './utils/persistenceValidation';
import { WorkflowStatus } from './components/WorkflowStatus';
import { normalizeMandatoryCourses, normalizeMandatoryCourseKeys, normalizePreferenceTime, reconcilePreferencesWithCatalog, sanitizePreferenceValues } from './utils/preferenceValidation';
import { resetBodyScrollLock } from './hooks/useModalAccessibility';
import { createGenerationId } from './domain/workflow';
import { cloneDomain } from './domain/clone';
import { APP_VERSION } from './domain/storage';
import { RESET_COORDINATOR } from './app/resetCoordinator';
import { scheduleCanonicalSignature } from './domain/results';
import { AddSectionsResult } from './features/courseBuilder/contracts';
import { updateSection as updateSectionDomain } from './domain/course';
import { getInfoModalFromHash as getCanonicalInfoModalFromHash, getStepHash, isAppStep, INFO_MODAL_HASHES, STEP_HASHES } from './app/navigation';
import { queueStorageWrite, cancelQueuedStorageWrite } from './utils/persistenceQueue';

const HowItWorksModal = lazy(() => import('./components/HowItWorksModal').then((m) => ({ default: m.HowItWorksModal })));
const DemoModal = lazy(() => import('./components/DemoModal').then((m) => ({ default: m.DemoModal })));
const PromiseModal = lazy(() => import('./components/PromiseModal').then((m) => ({ default: m.PromiseModal })));
const PrivacyModal = lazy(() => import('./components/PrivacyModal').then((m) => ({ default: m.PrivacyModal })));
const StepResults = lazy(() => import('./components/StepResults').then((m) => ({ default: m.StepResults })));
const RAW_FEEDBACK_EMAIL = String(import.meta.env.VITE_FEEDBACK_EMAIL || '').trim();
const FEEDBACK_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(RAW_FEEDBACK_EMAIL) ? RAW_FEEDBACK_EMAIL : '';
const initialWorkflowGenerationId = createGenerationId('wf');


export default function App() {
  const [workflow, dispatchWorkflow] = useReducer(courseBuilderWorkflowReducer, initialCourseBuilderWorkflow);
  const { isOnline, wasOffline, ocrServiceAvailable, refreshConnectivity } = useOnlineStatus();
  const [persistenceWarning, setPersistenceWarning] = useState(false);
  const [optimizerErrorMessage, setOptimizerErrorMessage] = useState<string | null>(null);
  const optimizerErrorRef = useRef<HTMLDivElement | null>(null);
  const [optimizerErrorMeta, setOptimizerErrorMeta] = useState<{ code: string; retryable: boolean } | null>(null);
  const [lastWorkflowAction, setLastWorkflowAction] = useState<string | null>(null);
  const [resetAnnouncement, setResetAnnouncement] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const workflowGenerationRef = useRef(initialWorkflowGenerationId);
  const resetGenerationRef = useRef(0);
  const resetAnnouncementTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!optimizerErrorMessage) return;
    const frame = window.requestAnimationFrame(() => optimizerErrorRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [optimizerErrorMessage]);


  useEffect(() => {
    resetBodyScrollLock();
    if (typeof window !== 'undefined') {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  useEffect(() => {
    // Persistence readers perform schema-aware migration at the data boundary.
    safeStorage.setItem(STORAGE_KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  }, []);

  // Read and sanitize persisted state once per mount. Reuse these values across
  // all lazy state initializers to avoid repeated synchronous storage reads/parses
  // during navigation and other App re-renders.
  const initialDataRef = useRef<{
    sections: Section[];
    preferences: SchedulePreferences;
    optimizerOutput: OptimizerOutput | null;
  } | null>(null);
  if (initialDataRef.current === null) {
    initialDataRef.current = {
      sections: readSavedSections(),
      preferences: readSavedPreferences(),
      optimizerOutput: readSavedOptimizerOutput(),
    };
  }
  const {
    sections: initialSections,
    preferences: initialPreferences,
    optimizerOutput: initialOptimizerOutput,
  } = initialDataRef.current;

  // Optimizer output state (hydrated from localStorage)
  const [optimizerOutput, setOptimizerOutput] = useState<OptimizerOutput | null>(() => initialOptimizerOutput);

  const optimizerOutputRef = useRef<OptimizerOutput | null>(optimizerOutput);
  const [isCalculating, setIsCalculating] = useState(false);
  const optimizerRequestIdRef = useRef(0);
  const optimizerTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => () => {
    if (resetAnnouncementTimerRef.current !== null) window.clearTimeout(resetAnnouncementTimerRef.current);
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    disposeOptimizerWorker();
  }, []);

  useEffect(() => {
    optimizerOutputRef.current = optimizerOutput;
    try {
      if (optimizerOutput) {
        const ok = safeStorage.setItem(
          STORAGE_KEY_OPTIMIZER,
          JSON.stringify(createStorageEnvelope({ ...optimizerOutput, resultContractVersion: optimizerOutput.resultContractVersion || CURRENT_RESULT_CONTRACT_VERSION }, CURRENT_SCHEMA_VERSION))
        );
        setPersistenceWarning(!ok);
      } else {
        safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);
      }
    } catch (e) {
      console.error('Failed to save optimizer output:', e);
    }
  }, [optimizerOutput]);

  // Main app flow: home (front page), setup (build a week), then results (review schedules).
  // Hydrated from URL hash (#results / #setup / #home) or persistent storage
  const [currentStep, setCurrentStep] = useState<AppStep>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const pathname = typeof window !== 'undefined' ? normalizePathname(window.location.pathname) : '';
    const hasSavedResults = Boolean(initialOptimizerOutput && initialOptimizerOutput.signatureStatus === 'verified' && initialOptimizerOutput.sectionsSnapshotComplete === true && initialOptimizerOutput.preferencesSnapshotComplete === true && Array.isArray(initialOptimizerOutput.byDayCount));

    if ((hash === '#results' || pathname === '/results') && hasSavedResults) {
      return 'results';
    }
    if (hash === '#setup' || pathname === '/setup') {
      return 'setup';
    }
    if (hash === '#home' || pathname === '/home') {
      return 'home';
    }
    try {
      const savedStep = readSavedCurrentStep();
      if (savedStep === 'results' && hasSavedResults) {
        return 'results';
      }
      if (savedStep === 'setup' && initialSections.length > 0) {
        return 'setup';
      }
      if (savedStep === 'home') {
        return 'home';
      }
    } catch {}
    if (initialSections.length > 0) {
      return 'setup';
    }
    return 'home';
  });

  // Unknown route detection for 404 feedback (Problem #4)
  const [unknownRouteNotice, setUnknownRouteNotice] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    // Normalize away a trailing slash (some hosting providers/CDNs append one
    // automatically on deep links, e.g. "/results/") so a legitimate route isn't
    // mistaken for an unknown one. Query strings and hash fragments are already
    // excluded from `pathname` by the browser, but the trailing-slash case wasn't
    // previously handled.
    const pathname = normalizePathname(window.location.pathname);
    // Known valid root paths: '/', '', '/index.html', '/results', '/setup', or '/home'
    if (pathname && pathname !== '/' && pathname !== '/index.html' && pathname !== '/results' && pathname !== '/setup' && pathname !== '/home') {
      return pathname;
    }
    return null;
  });

  // Normalize unknown path gracefully via replaceState
  useEffect(() => {
    if (unknownRouteNotice && typeof window !== 'undefined') {
      const currentHash = window.location.hash;
      const targetHash = currentHash === '#results' || currentHash === '#setup' || currentHash === '#home'
        ? currentHash
        : '#home';
      window.history.replaceState({ step: currentStep }, '', targetHash);
    }
  }, [unknownRouteNotice, currentStep]);

  // Course sections catalog state with schema validation
  const [sections, setSections] = useState<Section[]>(() => initialSections);

  // Active workflow panel within course builder ('start' | 'screenshots' | 'manual' | 'preferences')
  const [workflowPanel, setWorkflowPanel] = useState<WorkflowPanel>(() => {
    if (initialSections.length > 0) {
      return 'preferences';
    }
    return 'start';
  });

  const workflowPanelRef = useRef<WorkflowPanel>(workflowPanel);
  const scrollTaskRef = useRef<{ generation: number; raf?: number; timers: number[] }>({ generation: 0, timers: [] });
  const pageScrollPositionsRef = useRef<Record<AppStep, number>>({ home: 0, setup: 0, results: 0 });
  useEffect(() => {
    workflowPanelRef.current = workflowPanel;
  }, [workflowPanel]);

  // Smoothly scroll to the Add Courses choice section at the bottom of the home page
  const cancelPendingScroll = useCallback(() => {
    const task = scrollTaskRef.current;
    task.generation += 1;
    if (task.raf !== undefined) window.cancelAnimationFrame(task.raf);
    task.timers.forEach((timer) => window.clearTimeout(timer));
    scrollTaskRef.current = { generation: task.generation, timers: [] };
  }, []);

  const scrollToAddCoursesArea = useCallback(() => {
    cancelPendingScroll();
    const generation = scrollTaskRef.current.generation;
    const doScroll = () => {
      if (scrollTaskRef.current.generation !== generation) return true;
      const dropzone = document.getElementById('responsive-choice-section') || document.getElementById('responsive-add-title') || document.getElementById('upload-dropzone') || document.getElementById('step-add-courses-container');
      if (dropzone) {
        dropzone.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    };
    if (!doScroll()) {
      scrollTaskRef.current.raf = window.requestAnimationFrame(doScroll);
      scrollTaskRef.current.timers.push(window.setTimeout(doScroll, 60), window.setTimeout(doScroll, 180));
    }
  }, [cancelPendingScroll]);

  const handleWorkflowPanelChange = (panel: WorkflowPanel) => {
    cancelPendingScroll();
    const previousPanel = workflowPanelRef.current;
    setWorkflowPanel(panel);
    if (panel === 'screenshots' || panel === 'manual' || panel === 'preferences') {
      if (currentStep !== 'setup') {
        navigateToStep('setup', true);
      }
    } else if (panel === 'start') {
      const wasInWorkflow = previousPanel === 'screenshots' || previousPanel === 'manual';
      if (currentStep !== 'home') {
        navigateToStep('home', true, !wasInWorkflow);
      }
      if (wasInWorkflow) {
        scrollToAddCoursesArea();
      }
    }
  };

  // Schedule Preferences State with schema validation
  const [preferences, setPreferences] = useState<SchedulePreferences>(() => initialPreferences);
  const preferencesRef = useRef<SchedulePreferences>(initialPreferences);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);

  useEffect(() => {
    const generatedSig = optimizerOutput?.generatedInputsSignature;
    const currentSig = sections.length && optimizerOutput ? computeInputsSignature(sections, preferences) : null;
    const isStale = Boolean(optimizerOutput && (!generatedSig || !currentSig || generatedSig !== currentSig));
    const reconciled = reconcileCourseBuilderWorkflow(workflow, { hasSections: sections.length > 0, hasResults: optimizerOutput !== null, isStale, isProcessing: isCalculating, hasRetryableError: Boolean(optimizerErrorMeta?.retryable) });
    if (reconciled.phase !== workflow.phase) {
      const actionByPhase: Record<string, CourseBuilderAction> = {
        idle: { type: 'RESET' }, results: { type: 'RESULTS_READY' }, stale: { type: 'STALE' }, ready: { type: 'READY' },
        cancelled: { type: 'CANCELLED' }, 'retryable-error': { type: 'RETRYABLE_ERROR' }, 'partial-success': { type: 'PARTIAL_SUCCESS' }, error: { type: 'ERROR' },
      };
      const action = actionByPhase[reconciled.phase];
      if (action) dispatchWorkflow(action);
    }
  }, [sections.length, optimizerOutput, preferences, workflow.phase, isCalculating, optimizerErrorMeta]);

  const completedSteps = useMemo(() => ({ setup: sections.length > 0, results: Boolean(optimizerOutput && optimizerOutput.signatureStatus === 'verified') }), [sections.length, optimizerOutput]);
  const derivedWorkflowPhase = useMemo(() => { if (isCalculating) return 'processing'; if (optimizerErrorMeta?.retryable) return 'retryable-error'; if (sections.length === 0 && currentStep === 'home') return 'idle'; if (isResultsStale) return 'stale'; if (optimizerOutput?.signatureStatus === 'verified') return 'results'; return sections.length > 0 ? 'ready' : workflow.phase; }, [isCalculating, optimizerErrorMeta, sections.length, optimizerOutput, isResultsStale, workflow.phase]);

  // App-level navigation is centralized here so URL, visible step, persistence,
  // and scroll position cannot drift apart.
  function canNavigateTo(step: AppStep): boolean {
    if (step === 'home' || step === 'setup') return true;
    return optimizerOutputRef.current !== null && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true;
  }

  const syncNavigationFromLocation = useCallback((preferStoredBareRoot = false) => {
    setIsConfirmResetOpen(false);
    const hash = window.location.hash.toLowerCase();
    const pathname = normalizePathname(window.location.pathname).toLowerCase();

    const infoModal = getCanonicalInfoModalFromHash(hash);
    if (infoModal) {
      const storedStep = readSavedCurrentStep();
      const rawUnderlying = window.history.state?.gadwalUnderlyingStep;
      const currentSemanticSignature = optimizerOutputRef.current ? computeInputsSignature(sectionsRef.current, preferencesRef.current) : '';
      const historyStateMatches = !optimizerOutputRef.current?.generatedInputsSignature || !currentSemanticSignature || optimizerOutputRef.current.generatedInputsSignature === currentSemanticSignature;
      const canShowResults = Boolean(optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && historyStateMatches);
      const underlyingStep: AppStep = isAppStep(rawUnderlying) && (rawUnderlying !== 'results' || canShowResults) ? rawUnderlying : (storedStep === 'results' && canShowResults ? 'results' : storedStep === 'setup' && sectionsRef.current.length > 0 ? 'setup' : 'home');
      setCurrentStep(underlyingStep);
      if (underlyingStep === 'home') setWorkflowPanel('start');
      else if (underlyingStep === 'setup') setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
      else setWorkflowPanel('preferences');
      setIsDemoModalOpen(infoModal === 'demo');
      setIsHowItWorksModalOpen(infoModal === 'how-it-works');
      setIsPromiseModalOpen(infoModal === 'promise');
      setIsPrivacyModalOpen(infoModal === 'privacy');
      return;
    }

    setIsDemoModalOpen(false);
    setIsHowItWorksModalOpen(false);
    setIsPromiseModalOpen(false);
    setIsPrivacyModalOpen(false);

    let nextStep: AppStep = 'home';
    if (hash === '#results' || (!hash && pathname === '/results')) {
      const currentSemanticSignature = optimizerOutputRef.current ? computeInputsSignature(sectionsRef.current, preferencesRef.current) : '';
      const historyStateMatches = Boolean(optimizerOutputRef.current?.generatedInputsSignature && currentSemanticSignature && optimizerOutputRef.current.generatedInputsSignature === currentSemanticSignature);
      nextStep = optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && historyStateMatches ? 'results' : (sectionsRef.current.length > 0 ? 'setup' : 'home');
    } else if (hash === '#setup' || (!hash && pathname === '/setup')) {
      nextStep = 'setup';
    } else if (hash === '#home' || (!hash && pathname === '/home')) {
      nextStep = 'home';
    } else if (!hash && pathname === '/' && preferStoredBareRoot) {
      // On a fresh load at the bare root, preserve the saved workflow location.
      const savedStep = readSavedCurrentStep();
      if (savedStep === 'results' && optimizerOutputRef.current && optimizerOutputRef.current.signatureStatus === 'verified' && optimizerOutputRef.current.sectionsSnapshotComplete === true && optimizerOutputRef.current.preferencesSnapshotComplete === true && optimizerOutputRef.current.generatedInputsSignature === computeInputsSignature(sectionsRef.current, preferencesRef.current)) {
        nextStep = 'results';
      } else if (savedStep === 'setup' && sectionsRef.current.length > 0) {
        nextStep = 'setup';
      } else {
        nextStep = 'home';
      }
    }

    const targetHash = getStepHash(nextStep);
    if (window.location.hash !== targetHash || (pathname !== '/' && !['/home','/setup','/results'].includes(pathname))) {
      window.history.replaceState({ step: nextStep, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
    }

    setCurrentStep(nextStep);

    if (nextStep === 'home') {
      setWorkflowPanel('start');
    } else if (nextStep === 'setup') {
      setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
    }

    cancelPendingScroll();
    window.requestAnimationFrame(() => {
      const y = pageScrollPositionsRef.current[nextStep] || 0;
      window.scrollTo({ top: y, left: 0, behavior: 'auto' });
    });
  }, [cancelPendingScroll]);

  const navigateToStep = useCallback((step: AppStep, pushHistory = true, shouldScrollToTop = true): boolean => {
    if (!canNavigateTo(step)) return false;
    const previousStep = currentStep;
    pageScrollPositionsRef.current[previousStep] = window.scrollY || 0;
    setCurrentStep(step);
    if (pushHistory) saveCurrentStep(step);
    const targetHash = getStepHash(step);

    if (window.location.hash !== targetHash) {
      if (pushHistory) {
        window.history.pushState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
      } else {
        window.history.replaceState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
      }
    } else if (!pushHistory) {
      window.history.replaceState({ step, gadwalWorkflowGenerationId: optimizerOutputRef.current?.workflowGenerationId, gadwalGeneratedInputsSignature: optimizerOutputRef.current?.generatedInputsSignature }, '', targetHash);
    }

    if (step === 'home') {
      setWorkflowPanel('start');
    } else if (step === 'setup') {
      setWorkflowPanel((prev) => (prev === 'start' && sectionsRef.current.length === 0 ? 'screenshots' : prev));
    }

    cancelPendingScroll();
    const scrollGeneration = scrollTaskRef.current.generation;
    const scheduleScroll = () => {
      if (scrollTaskRef.current.generation !== scrollGeneration) return;
      window.scrollTo({ top: shouldScrollToTop ? 0 : (pageScrollPositionsRef.current[step] || 0), left: 0, behavior: 'auto' });
    };
    scrollTaskRef.current.raf = window.requestAnimationFrame(scheduleScroll);
    return true;
  }, [currentStep, canNavigateTo, cancelPendingScroll]);

  // Keep direct hash edits and browser Back/Forward synchronized with React state.
  useEffect(() => {
    syncNavigationFromLocation(true);

    let lastLocationKey = `${window.location.pathname}${window.location.hash}`;
    const handleHistoryNavigation = () => { const key = `${window.location.pathname}${window.location.hash}`; if (key === lastLocationKey) return; lastLocationKey = key; syncNavigationFromLocation(false); };
    window.addEventListener('popstate', handleHistoryNavigation);
    window.addEventListener('hashchange', handleHistoryNavigation);
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation);
      window.removeEventListener('hashchange', handleHistoryNavigation);
    };
  }, [syncNavigationFromLocation]);

  // Global modals state
  const [isHowItWorksModalOpen, setIsHowItWorksModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isPromiseModalOpen, setIsPromiseModalOpen] = useState(false);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const modalRestoreFocusRef = useRef<HTMLElement | null>(null);
  type InfoModal = 'demo' | 'how-it-works' | 'promise' | 'privacy';
  const closeInfoModal = useCallback((kind: InfoModal) => {
    const current = getInfoModalFromHash(window.location.hash.toLowerCase());
    if (current === kind) {
      const rawUnderlying = window.history.state?.gadwalUnderlyingStep;
      const underlyingStep = isAppStep(rawUnderlying) ? rawUnderlying : currentStep;
      if (window.history.state?.gadwalInfoModal === kind) {
        window.history.back();
      } else {
        window.history.replaceState({ step: underlyingStep }, '', getStepHash(underlyingStep));
      }
    }
    if (kind === 'demo') setIsDemoModalOpen(false);
    if (kind === 'how-it-works') setIsHowItWorksModalOpen(false);
    if (kind === 'promise') setIsPromiseModalOpen(false);
    if (kind === 'privacy') setIsPrivacyModalOpen(false);
  }, [currentStep]);
  const openInfoModal = useCallback((kind: InfoModal, trigger?: HTMLElement | null) => {
    if (trigger) modalRestoreFocusRef.current = trigger;
    setIsDemoModalOpen(false); setIsHowItWorksModalOpen(false); setIsPromiseModalOpen(false); setIsPrivacyModalOpen(false);
    const hash = INFO_MODAL_HASHES[kind];
    const currentHash = window.location.hash.toLowerCase();
    if (currentHash !== hash) {
      window.history.pushState({ gadwalInfoModal: kind, gadwalUnderlyingStep: currentStep, step: currentStep }, '', hash);
    }
    if (kind === 'demo') setIsDemoModalOpen(true);
    if (kind === 'how-it-works') setIsHowItWorksModalOpen(true);
    if (kind === 'promise') setIsPromiseModalOpen(true);
    if (kind === 'privacy') setIsPrivacyModalOpen(true);
  }, [currentStep]);
  const closeInfoAndNavigate = useCallback((kind: InfoModal, step: AppStep, workflowPanel?: WorkflowPanel) => {
    if (workflowPanel) setWorkflowPanel(workflowPanel);
    if (kind === 'demo') setIsDemoModalOpen(false);
    if (kind === 'how-it-works') setIsHowItWorksModalOpen(false);
    if (kind === 'promise') setIsPromiseModalOpen(false);
    if (kind === 'privacy') setIsPrivacyModalOpen(false);
    saveCurrentStep(step);
    window.history.replaceState({ step }, '', getStepHash(step));
    setCurrentStep(step);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, []);


  useEffect(() => {
    // Clean up any legacy test font style tag or storage
    const styleTag = document.getElementById('gadwal-test-font-style');
    if (styleTag) styleTag.remove();
    safeStorage.removeItem('gadwal_test_font');
  }, []);

  // Cancel any active in-flight calculation when inputs change
  const invalidateResults = () => {
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
  };

  // Determine if calculated results are stale relative to current sections and preferences
  const staleChangeSummary = useMemo(() => {
    return getInputsChangeSummary(optimizerOutput, sections, preferences);
  }, [optimizerOutput, sections, preferences]);

  const isResultsStale = staleChangeSummary.isStale;

  // Sync state to durable versioned snapshots. A failed write leaves the prior
  // recoverable snapshot untouched rather than pretending the new state was saved.
  useEffect(() => {
    const payload = JSON.stringify(createStorageEnvelope(sections, CURRENT_SCHEMA_VERSION));
    queueStorageWrite(STORAGE_KEY_SECTIONS, payload);
  }, [sections]);

  useEffect(() => {
    const payload = JSON.stringify(createStorageEnvelope(preferences, CURRENT_SCHEMA_VERSION));
    queueStorageWrite(STORAGE_KEY_PREFS, payload);
  }, [preferences]);

  const sectionsRef = useRef<Section[]>(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // Section additions & merge handler. Course identity is code-first and visible
  // section codes are the only identifiers used for catalog deduplication. OCR
  // internal IDs are never compared with catalog section codes.
  const handleAddSections = (newSections: Section[]): AddSectionsResult => {
    const existing = sectionsRef.current;
    const courseIdentity = (section: Section) => getCourseIdentityKey(section.courseCode, section.name);
    // OCR facts are never silently synchronized to existing catalog values.
    // Conflicting credits are retained as an explicit review state by the
    // identity-safe deduplication layer instead of choosing the old value.
    const normalizedIncomingSections = newSections.map((section) => ({
      ...section,
      workflowGenerationId: section.workflowGenerationId || workflowGenerationRef.current,
      courseKey: courseIdentity(section),
      sectionCode: section.sectionCode?.trim() || null,
      sectionCodeMissing: Boolean(section.sectionCodeMissing || !section.sectionCode?.trim()),
    }));

    const { insertedSections, updatedSections, updatedAllSections, skippedCount, updatedCount } = deduplicateSections(
      existing,
      normalizedIncomingSections,
    );

    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = updatedAllSections;
    setSections(updatedAllSections);

    if (insertedSections.length > 0 || updatedCount > 0) {
      invalidateResults();
    }

    return { insertedSections, updatedSections, updatedAllSections, skippedCount, updatedCount, creditsAdjustedCount: 0 };
  };

  const handleDeleteCourse = (courseName: string, courseKey?: string) => {
    const targetNorm = normalizeCourseName(courseName);
    const nextSections = sectionsRef.current.filter((s) => {
      const identity = getCourseIdentityKey(s.courseCode, s.name);
      return courseKey ? identity !== courseKey : normalizeCourseName(s.name) !== targetNorm;
    });
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = nextSections;
    setSections(nextSections);
    invalidateResults();
  };

  const handleDeleteSection = (sectionId: string, courseName?: string, courseKey?: string): boolean => {
    if (!courseName || !courseName.trim()) {
      console.warn('Refusing ambiguous section deletion without course name:', sectionId);
      return false;
    }
    const targetId = sectionId.trim();
    const targetCourseNorm = normalizeCourseName(courseName);
    const exactMatches = sectionsRef.current.filter((s) => s.id.trim() === targetId && (!courseKey || (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === courseKey) && normalizeCourseName(s.name) === targetCourseNorm);
    let targetIndex = -1;
    if (exactMatches.length === 1) {
      targetIndex = sectionsRef.current.findIndex((s) => s.id.trim() === targetId && normalizeCourseName(s.name) === targetCourseNorm);
    } else if (exactMatches.length > 1) {
      console.warn('Refusing section deletion because the internal section ID is duplicated:', sectionId);
      return false;
    } else {
      const canonicalTarget = canonicalizeSectionIdentity(targetId);
      const fallbackMatches = sectionsRef.current.filter((s) =>
        normalizeCourseName(s.name) === targetCourseNorm && canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalTarget
      );
      if (fallbackMatches.length !== 1) {
        console.warn('Refusing ambiguous section deletion:', sectionId, courseName);
        return false;
      }
      targetIndex = sectionsRef.current.findIndex((s) =>
        normalizeCourseName(s.name) === targetCourseNorm && canonicalizeSectionIdentity(String(s.sectionCode || '')) === canonicalTarget
      );
    }
    if (targetIndex < 0) return false;
    const remaining = sectionsRef.current.filter((_, index) => index !== targetIndex);
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = remaining;
    setSections(remaining);
    invalidateResults();
    return true;
  };

  const handleUpdateSection = (originalId: string, updatedSection: Section, originalCourseName?: string, originalCourseKey?: string, originalSectionKey?: string): boolean => {
    const result = updateSectionDomain(sectionsRef.current, originalId, updatedSection, { originalCourseName, originalCourseKey, originalSectionKey });
    if (!result.accepted) return false;
    cancelQueuedStorageWrite(STORAGE_KEY_SECTIONS);
    sectionsRef.current = result.sections;
    setSections(result.sections);
    // A section edit can change the optimizer inputs even when course identity remains
    // stable, so all edits intentionally invalidate an existing result.
    invalidateResults();
    return true;
  };

  // Reconcile persisted preferences against the current catalog at the data boundary.
  // This prevents impossible/stale targets and malformed mandatory identities from reaching the optimizer.
  useEffect(() => {
    if (sections.length === 0) return;
    const creditValuesByCourse = new Map<string, Set<number>>();
    for (const section of sections) {
      if (section.credits == null || !Number.isFinite(Number(section.credits))) continue;
      const key = getCourseIdentityKey(section.courseCode, section.name);
      const set = creditValuesByCourse.get(key) || new Set<number>();
      set.add(Number(section.credits));
      creditValuesByCourse.set(key, set);
    }
    const totalCatalogCredits = Array.from(creditValuesByCourse.values())
      .filter((values) => values.size === 1)
      .reduce((sum, values) => sum + Array.from(values)[0], 0);
    const reconciled = reconcilePreferencesWithCatalog(preferences, sections, totalCatalogCredits);
    if (!areSchedulePreferencesEqual(reconciled, preferences)) {
      setPreferences(reconciled);
      optimizerRequestIdRef.current++;
      optimizerTaskRef.current?.cancel();
      optimizerTaskRef.current = null;
    }
  }, [sections]);

  // Synchronize mandatory course identities with the current catalog so deleted
  // courses never persist as stale optimizer constraints.
  useEffect(() => {
    const existingKeys = new Set(sections.map((s) => s.courseKey || getCourseIdentityKey(s.courseCode, s.name)));
    const byName = new Map<string, string[]>();
    for (const section of sections) {
      const key = section.courseKey || getCourseIdentityKey(section.courseCode, section.name);
      const name = normalizeCourseName(section.name);
      if (name) byName.set(name, [...(byName.get(name) || []), key]);
    }
    setPreferences((prev) => {
      const keys = normalizeMandatoryCourseKeys(prev.mandatoryCourseKeys).filter((key) => existingKeys.has(key));
      for (const legacyName of normalizeMandatoryCourses(prev.mandatoryCourses)) {
        const matches = Array.from(new Set(byName.get(normalizeCourseName(legacyName)) || []));
        if (matches.length === 1 && !keys.some((key) => key.toLowerCase() === matches[0].toLowerCase())) keys.push(matches[0]);
      }
      const labels = keys.map((key) => sections.find((s) => (s.courseKey || getCourseIdentityKey(s.courseCode, s.name)) === key)?.name?.trim() || '').filter(Boolean);
      const previousKeys = normalizeMandatoryCourseKeys(prev.mandatoryCourseKeys).slice().sort();
      const nextKeys = keys.slice().sort();
      if (previousKeys.join("|") !== nextKeys.join("|") || Array.from(new Set(labels)).sort().join("|") !== Array.from(new Set(prev.mandatoryCourses || [])).sort().join("|")) {
        return { ...prev, mandatoryCourseKeys: keys, mandatoryCourses: Array.from(new Set(labels)) };
      }
      return prev;
    });
  }, [sections]);

  const handleUpdatePreferences = (newPrefs: SchedulePreferences) => {
    const canonicalPrefs = { ...preferences, ...sanitizePreferenceValues(newPrefs) };
    setPreferences(canonicalPrefs);
    safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);
    invalidateResults();
  };

  const handleClearSections = () => {
    RESET_COORDINATOR.reset('user-reset');
    resetGenerationRef.current += 1;
    workflowGenerationRef.current = createGenerationId('wf');
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
    sectionsRef.current = [];
    setSections([]);
    setPreferences(DEFAULT_PREFERENCES);
    setOptimizerOutput(null);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    clearAllPersistedAppData();
    safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);

    setResetVersion((v) => v + 1);
    setWorkflowPanel('start');
    navigateToStep('home', false);
    setIsConfirmResetOpen(false);
    setResetAnnouncement('Everything was cleared. You can start a new schedule.');
    if (resetAnnouncementTimerRef.current !== null) window.clearTimeout(resetAnnouncementTimerRef.current);
    resetAnnouncementTimerRef.current = window.setTimeout(() => {
      resetAnnouncementTimerRef.current = null;
      setResetAnnouncement(null);
    }, 5000);
    setIsPrivacyModalOpen(false);
    setIsDemoModalOpen(false);
    setIsHowItWorksModalOpen(false);
    setIsPromiseModalOpen(false);
    resetBodyScrollLock();
  };

  // Run Optimization Algorithm with user preferences
  const executeOptimizer = async (prefsToUse: SchedulePreferences, navigateToResultsOnSuccess: boolean) => {
    const reqId = ++optimizerRequestIdRef.current;
    const generationAtStart = workflowGenerationRef.current;
    const sectionsSnapshotAtStart = cloneDomain(sections);
    const preferencesSnapshotAtStart = cloneDomain(prefsToUse);
    cancelOptimizerOwner('live-estimate');
    dispatchWorkflow({ type: 'GENERATION_STARTED' });
    setIsCalculating(true);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    setLastWorkflowAction(null);
    try {
      const { courseMap, fixedCourses } = buildOptimizerCourseMap(sectionsSnapshotAtStart);

      const task = runOptimizerAsyncCancellable({
        courses: courseMap,
        fixedCourses,
        preferences: prefsToUse,
      }, { owner: 'user-run', cancelPreviousOwner: true });
      optimizerTaskRef.current = task;
      const rawOutput = await task.promise;
      const generatedOutput = { ...rawOutput, resultContractVersion: CURRENT_RESULT_CONTRACT_VERSION, workflowGenerationId: generationAtStart };

      if (reqId !== optimizerRequestIdRef.current || generationAtStart !== workflowGenerationRef.current) {
        // Stale in-flight calculation discarded because inputs or step changed
        return;
      }

      const output: OptimizerOutput = {
        ...generatedOutput,
        generatedInputsSignature: computeInputsSignature(sectionsSnapshotAtStart, preferencesSnapshotAtStart),
        generatedAt: Date.now(),
        sectionsSnapshot: cloneDomain(sectionsSnapshotAtStart),
        preferencesUsed: cloneDomain(preferencesSnapshotAtStart),
        buildVersion: APP_VERSION,
      };

      optimizerOutputRef.current = output;
      setOptimizerOutput(output);
      setLastWorkflowAction('Schedules generated successfully.');
      if (navigateToResultsOnSuccess) {
        navigateToStep('results', true);
      }
    } catch (err: any) {
      console.error('Failed to run optimizer:', err);
      if (reqId === optimizerRequestIdRef.current) {
        const raw = String(err?.message || '');
        const cancelled = /cancel/i.test(raw);
        const noResults = /no schedule|no valid|couldn.t find/i.test(raw) || err?.code === 'NO_RESULTS';
        if (cancelled) {
          setOptimizerErrorMessage(null);
          setOptimizerErrorMeta(null);
          setLastWorkflowAction('Search stopped by you.');
          dispatchWorkflow({ type: 'CANCELLED' });
        } else if (noResults) {
          setOptimizerErrorMessage('We couldn’t find a schedule that matches all of your choices. Try relaxing one constraint.');
          setOptimizerErrorMeta({ code: 'NO_RESULTS', retryable: false });
          dispatchWorkflow({ type: 'ERROR', reasonCode: 'NO_RESULTS' });
        } else {
          setOptimizerErrorMessage('The schedule search stopped unexpectedly. Your courses are still safe. Try the search again.');
          setOptimizerErrorMeta({ code: 'SEARCH_FAILED', retryable: true });
          setLastWorkflowAction('Schedule search needs another try.');
          dispatchWorkflow({ type: 'RETRYABLE_ERROR', reasonCode: 'SEARCH_FAILED' });
        }
      }
    } finally {
      if (reqId === optimizerRequestIdRef.current) setIsCalculating(false);
      if (reqId === optimizerRequestIdRef.current) optimizerTaskRef.current = null;
    }
  };

  const handleCancelOptimizer = () => {
    optimizerRequestIdRef.current++;
    optimizerTaskRef.current?.cancel();
    optimizerTaskRef.current = null;
    setIsCalculating(false);
    setOptimizerErrorMessage(null);
    setOptimizerErrorMeta(null);
    setLastWorkflowAction('Search stopped by you.');
    dispatchWorkflow({ type: 'CANCELLED' });
  };

  const handleRunOptimizer = () => {
    if (isCalculating) return;
    // A first run from Setup should take the user to Results when it finishes.
    // A recompute started from Results must not yank the user back to Results
    // if they navigate away while the async calculation is in flight.
    executeOptimizer(preferences, currentStep === 'setup');
  };

  const handleAutoFixPreference = (updated: Partial<SchedulePreferences>) => {
    if (isCalculating) return;
    // Preferences are independent constraints. Never discard course count merely
    // because another preference changed.
    const newPrefs = { ...preferences, ...sanitizePreferenceValues({ ...preferences, ...updated }) };
    safeStorage.removeItem(STORAGE_KEY_OPTIMIZER);
    optimizerRequestIdRef.current++;
    setOptimizerOutput(null);
    setPreferences(newPrefs);
    executeOptimizer(newPrefs, false);
  };

  // Safe navigation home without clearing user data
  const handleGoHome = () => {
    setWorkflowPanel('start');
    navigateToStep('home', true, true);
  };


  // Distinct course count for clean header display
  const distinctCoursesCount = useMemo(() => {
    return new Set(sections.map((s) => s.courseKey || getCourseIdentityKey(s.courseCode, s.name))).size;
  }, [sections]);

  return (
    <div className="min-h-screen flex flex-col bg-white text-ink antialiased selection:bg-ink selection:text-white" data-workflow-phase={derivedWorkflowPhase}>
      {/* Header */}
      <Header
        totalCoursesCount={distinctCoursesCount}
        currentStep={currentStep}
        onNavigateStep={(step) => navigateToStep(step, true)}
        onGoHome={handleGoHome}
        onReset={() => setIsConfirmResetOpen(true)}
        onOpenHowItWorks={(trigger) => openInfoModal('how-it-works', trigger)}
        onOpenPromise={(trigger) => openInfoModal('promise', trigger)}
        onOpenDemo={(trigger) => openInfoModal('demo', trigger)}
        isOnline={isOnline}
      />

      {persistenceWarning && (
        <div role="status" aria-live="polite" className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-3">
          <div className="p-3 bg-caution-soft border border-caution-line rounded-sm text-sm sm:text-sm text-caution-strong">
            <strong>We can’t save your changes right now.</strong> Your changes may be lost if you close this tab. Keep it open for now.
          </div>
        </div>
      )}

      {/* Unknown Path / 404 Notice Banner (Problem #4) */}
      {unknownRouteNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-4"
        >
          <div className="p-4 bg-paper border border-line-strong rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm sm:text-sm text-ink shadow-xs animate-in fade-in duration-200">
            <div className="flex items-start sm:items-center gap-2.5">
              <Compass className="w-5 h-5 text-accent shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-bold block">Page not found <span className="font-mono text-sm text-text-secondary">{unknownRouteNotice}</span></span>
                <span className="text-text-secondary text-sm">
                  That page doesn’t exist. You’re back at Gadwal.
                </span>
              </div>
            </div>
            <button
              type="button"
              id="btn-dismiss-unknown-route-notice"
              onClick={() => { setUnknownRouteNotice(null); navigateToStep('home', false, true); }}
              className="px-3 py-1.5 text-sm font-bold text-text-secondary hover:text-ink bg-mist hover:bg-line rounded-sm cursor-pointer transition shrink-0 self-end sm:self-auto"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main id="gadwal-main-content" aria-label="Gadwal schedule planner" aria-busy={isCalculating} className="flex-1 pb-16">
        {(currentStep === 'home' || currentStep === 'setup') && (
          <>
            {currentStep === 'home' && workflowPanel === 'start' && sections.length === 0 && (
              <HeroBanner
                onOpenHowItWorks={() => openInfoModal('how-it-works')}
                onGetStarted={() => {
                  const dropzone =
                    document.getElementById('responsive-choice-section') ||
                    document.getElementById('responsive-add-title') ||
                    document.getElementById('upload-dropzone') ||
                    document.getElementById('step-add-courses-container');
                  dropzone?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  const choiceBtn = dropzone?.querySelector<HTMLButtonElement>('.responsive-big-choice');
                  if (choiceBtn) {
                    window.setTimeout(() => choiceBtn.focus({ preventScroll: true }), 350);
                  }
                }}
              />
            )}

            <StepAddCourses
              key={`step-add-${resetVersion}`}
              workflowPanel={workflowPanel}
              onWorkflowPanelChange={handleWorkflowPanelChange}
              workflow={workflow}
              resetVersion={resetVersion}
              workflowGenerationId={workflowGenerationRef.current}
              dispatchWorkflow={dispatchWorkflow}
              sections={sections}
              onAddSections={handleAddSections}
              onDeleteCourse={handleDeleteCourse}
              onDeleteSection={handleDeleteSection}
              onUpdateSection={handleUpdateSection}
              onClearSections={() => setIsConfirmResetOpen(true)}
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              onRunOptimizer={handleRunOptimizer}
              onCancelOptimizer={handleCancelOptimizer}
              onOpenHowItWorks={(trigger) => openInfoModal('how-it-works', trigger)}
              onOpenDemo={(trigger) => openInfoModal('demo', trigger)}
              onGoHome={handleGoHome}
              isCalculating={isCalculating}
              hasPreviousResults={Boolean(
                optimizerOutput &&
                  (Object.values(optimizerOutput.byDayCount || {}).some((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                    Boolean(optimizerOutput.impossibleDiagnostic))
              )}
              isResultsStale={isResultsStale}
              staleReasons={staleChangeSummary.reasons}
              onViewPreviousResults={() => navigateToStep('results', false)}
              isOnline={isOnline}
              wasOffline={wasOffline}
              ocrServiceAvailable={ocrServiceAvailable}
              refreshConnectivity={refreshConnectivity}
            />
          </>
        )}

        {currentStep === 'results' && optimizerOutput && (
          <Suspense fallback={<div className="max-w-md mx-auto py-16 px-4 text-center text-sm text-text-secondary">Loading your schedules…</div>}>
          <StepResults
            key={`step-results-${resetVersion}`}
            optimizerOutput={optimizerOutput}
            preferences={preferences}
            sections={sections}
            onBackToSetup={() => navigateToStep('setup', false)}
            onAutoFixPreference={handleAutoFixPreference}
            isStale={isResultsStale}
            staleChangeSummary={staleChangeSummary}
            onRecomputeSchedules={handleRunOptimizer}
            onCancelOptimizer={handleCancelOptimizer}
            isCalculating={isCalculating}
          />
          </Suspense>
        )}

        {currentStep === 'results' && !optimizerOutput && (
          <div className="max-w-md mx-auto py-16 px-4 sm:px-6 text-center space-y-5 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-none bg-mist border border-line flex items-center justify-center mx-auto text-text-muted">
              <AlertCircle className="w-6 h-6 text-text-muted" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-ink tracking-tight">No schedules yet</h2>
              <p className="text-sm sm:text-sm text-text-secondary leading-relaxed">
                Add your courses, then tell us what matters to you.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => navigateToStep('setup', false)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-ink hover:bg-ink-soft text-white text-sm sm:text-sm font-bold rounded-sm transition cursor-pointer active:scale-98 shadow-xs"
              >
                <span>Back to courses</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Global Modals */}
      <ConfirmResetModal
        isOpen={isConfirmResetOpen}
        onClose={() => setIsConfirmResetOpen(false)}
        onConfirm={handleClearSections}
      />

      <Suspense fallback={null}>
      <HowItWorksModal
        isOpen={isHowItWorksModalOpen}
        onClose={() => closeInfoModal('how-it-works')}
        restoreFocusRef={modalRestoreFocusRef}
        onGetStarted={() => closeInfoAndNavigate('how-it-works', 'setup', 'screenshots')}
      />

      <DemoModal
        isOpen={isDemoModalOpen}
        onClose={() => closeInfoModal('demo')}
        restoreFocusRef={modalRestoreFocusRef}
        onGetStarted={() => closeInfoAndNavigate('demo', 'setup', 'screenshots')}
      />

      <PromiseModal
        isOpen={isPromiseModalOpen}
        onClose={() => closeInfoModal('promise')}
        restoreFocusRef={modalRestoreFocusRef}
        onGetStarted={() => closeInfoAndNavigate('promise', 'setup', 'screenshots')}
      />

      <PrivacyModal isOpen={isPrivacyModalOpen} onClose={() => setIsPrivacyModalOpen(false)} />
      </Suspense>

      {optimizerErrorMessage && (
        <WorkflowStatus
          kind={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'empty' : optimizerErrorMeta?.retryable ? 'error' : 'warning'}
          title={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'No schedule matched those choices.' : 'Schedule search needs attention.'}
          description={optimizerErrorMessage}
          actionLabel={optimizerErrorMeta?.retryable ? 'Retry search' : undefined}
          onAction={optimizerErrorMeta?.retryable ? handleRunOptimizer : undefined}
          secondaryActionLabel={optimizerErrorMeta?.code === 'NO_RESULTS' ? 'Change choices' : 'Dismiss'}
          onSecondaryAction={() => { setOptimizerErrorMessage(null); setOptimizerErrorMeta(null); if (optimizerErrorMeta?.code === 'NO_RESULTS') navigateToStep('setup', true); }}
          className="responsive-optimizer-toast fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-50"
          autoFocus
          containerRef={optimizerErrorRef}
        />
      )}

      {lastWorkflowAction && currentStep === 'results' && (
        <div className="sr-only" role="status" aria-live="polite">{lastWorkflowAction}</div>
      )}

      <footer className="site-footer border-t border-line bg-paper px-4 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-ink">Gadwal</p>
            <p className="text-sm text-text-secondary mt-1">Find a schedule that fits your day.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a href="#guide" onClick={(e) => { e.preventDefault(); openInfoModal('demo', e.currentTarget); }} className="min-h-[44px] inline-flex text-sm font-semibold text-text-secondary hover:text-ink underline underline-offset-4 transition-colors">See the screenshot guide</a>
            <a href="#how-it-works" onClick={(e) => { e.preventDefault(); openInfoModal('how-it-works', e.currentTarget); }} className="min-h-[44px] inline-flex text-sm font-semibold text-text-secondary hover:text-ink underline underline-offset-4 transition-colors">See how it works</a>
            <a href="#promise" onClick={(e) => { e.preventDefault(); openInfoModal('promise', e.currentTarget); }} className="min-h-[44px] inline-flex text-sm font-semibold text-text-secondary hover:text-ink underline underline-offset-4 transition-colors">Read our promise</a>
            <button type="button" onClick={(e) => openInfoModal('privacy', e.currentTarget)} className="min-h-[44px] text-sm font-semibold text-text-secondary hover:text-ink underline underline-offset-4 transition-colors">Privacy and data</button>
            {FEEDBACK_EMAIL && <a href={`mailto:${encodeURIComponent(FEEDBACK_EMAIL)}?subject=Gadwal%20feedback`} className="min-h-[44px] inline-flex items-center text-sm font-semibold text-text-secondary hover:text-ink underline underline-offset-4 transition-colors">Send feedback</a>}
          </div>
        </div>
      </footer>
    </div>
  );
}
