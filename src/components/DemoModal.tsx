import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowRight, ArrowLeft, Check, CheckCircle2, Layers } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { COPY } from '../content/copy';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

interface StepItem {
  id: number;
  chapterNumber: number;
  chapterLabel: string;
  chapterTitle: string;
  title: string;
  shortTitle: string;
}

const STEPS: StepItem[] = [
  {
    id: 1,
    chapterNumber: 1,
    chapterLabel: COPY.demo.chapter1Label,
    chapterTitle: COPY.demo.chapter1Title,
    title: COPY.demo.step1Title,
    shortTitle: 'Advising',
  },
  {
    id: 2,
    chapterNumber: 1,
    chapterLabel: COPY.demo.chapter1Label,
    chapterTitle: COPY.demo.chapter1Title,
    title: COPY.demo.step2Title,
    shortTitle: 'Clear schedule',
  },
  {
    id: 3,
    chapterNumber: 2,
    chapterLabel: COPY.demo.chapter2Label,
    chapterTitle: COPY.demo.chapter2Title,
    title: COPY.demo.step3Title,
    shortTitle: 'Open course',
  },
  {
    id: 4,
    chapterNumber: 2,
    chapterLabel: COPY.demo.chapter2Label,
    chapterTitle: COPY.demo.chapter2Title,
    title: COPY.demo.step4Title,
    shortTitle: 'Take screenshot',
  },
  {
    id: 5,
    chapterNumber: 2,
    chapterLabel: COPY.demo.chapter2Label,
    chapterTitle: COPY.demo.chapter2Title,
    title: COPY.demo.step5Title,
    shortTitle: 'Repeat options',
  },
  {
    id: 6,
    chapterNumber: 2,
    chapterLabel: COPY.demo.chapter2Label,
    chapterTitle: COPY.demo.chapter2Title,
    title: COPY.demo.step6Title,
    shortTitle: 'Summary',
  },
  {
    id: 7,
    chapterNumber: 3,
    chapterLabel: COPY.demo.chapter3Label,
    chapterTitle: COPY.demo.chapter3Title,
    title: COPY.demo.step7Title,
    shortTitle: 'Upload',
  },
];

const CHAPTER_GROUPS = [
  {
    chapterNumber: 1,
    label: COPY.demo.chapter1Label,
    shortLabel: COPY.demo.chapter1,
    stepIds: [1, 2],
  },
  {
    chapterNumber: 2,
    label: COPY.demo.chapter2Label,
    shortLabel: COPY.demo.chapter2,
    stepIds: [3, 4, 5, 6],
  },
  {
    chapterNumber: 3,
    label: COPY.demo.chapter3Label,
    shortLabel: COPY.demo.chapter3,
    stepIds: [7],
  },
];

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, onClose, onGetStarted, restoreFocusRef }) => {
  const [currentStep, setCurrentStep] = useState<number>(1);

  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef , manageHistory: false });

  // Reset step and popup on reopen
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
    }
  }, [isOpen]);

  const handleAction = useCallback(() => {
    if (onGetStarted) { onGetStarted(); return; }
    onClose();
    const dropzone = document.getElementById('upload-dropzone') || document.getElementById('step-add-courses-container');
    dropzone?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [onClose, onGetStarted]);

  const goToPrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    if (currentStep < 7) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleAction();
    }
  }, [currentStep, handleAction]);

  // Arrow navigation belongs to the guide tablist. It does not steal arrow keys
  // from inputs, links, or other interactive controls elsewhere in the dialog.
  const handleTimelineKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[role="tab"]')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext(); }
  }, [goToPrev, goToNext]);

  if (!isOpen) return null;

  const currentStepData = STEPS[currentStep - 1] || STEPS[0];

  return (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        aria-describedby="demo-modal-subtitle"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-sheet sm:max-w-4xl flex flex-col text-ink relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER - Title says Guide, subtitle text removed */}
        <div className="gd-modal-header z-20">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-ink text-white flex items-center justify-center shrink-0 shadow-xs">
              <Layers className="w-4 h-4 sm:w-4.5 sm:h-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="demo-modal-title" className="text-base sm:text-lg font-black tracking-tight text-ink font-sans truncate">
                {COPY.demo.title}
              </h2>
              <span id="demo-modal-subtitle" className="sr-only">{COPY.demo.howTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Close button */}
            <button
              type="button"
              id="demo-modal-close"
              onClick={onClose}
              aria-label="Close screenshot guide"
              className="gd-modal-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* VISUAL TIMELINE STRIP */}
        <div className="gd-modal-guide-timeline-wrap">
          <div className="px-3 sm:px-6 py-2 sm:py-2.5 bg-paper border-b border-line shrink-0 overflow-x-auto gd-modal-guide-timeline">
          <div
            role="tablist"
            aria-label="Demo steps timeline"
            aria-describedby="demo-steps-keyboard-help"
            onKeyDown={handleTimelineKeyDown}
            className="flex items-center justify-between max-w-2xl mx-auto gap-1.5 sm:gap-4"
          >
            <span id="demo-steps-keyboard-help" className="sr-only">Use Left and Right Arrow keys to change steps.</span>
            {CHAPTER_GROUPS.map((chapter) => {
              const isCurrentChapter = chapter.stepIds.includes(currentStep);
              return (
                <div
                  key={chapter.chapterNumber}
                  style={{ flex: chapter.stepIds.length }}
                  className="flex flex-col items-center min-w-0 px-0.5 sm:px-1"
                >
                  {/* Chapter Label above timeline nodes - PART 1, PART 2, PART 3 */}
                  <span
                    className={`text-[10px] sm:text-xs font-black uppercase tracking-wider mb-1 sm:mb-1.5 truncate text-center w-full block ${
                      isCurrentChapter ? 'text-ink' : 'text-text-muted'
                    }`}
                  >
                    {chapter.shortLabel}
                  </span>

                  {/* Nodes in this chapter */}
                  <div className="flex items-center justify-center w-full min-w-max px-2">
                    {chapter.stepIds.map((stepId, nodeIdx) => {
                      const isCurrent = currentStep === stepId;
                      const isCompleted = currentStep > stepId;
                      const stepData = STEPS[stepId - 1];

                      return (
                        <React.Fragment key={stepId}>
                          <button
                            type="button"
                            role="tab"
                            id={`demo-step-tab-${stepId}`}
                            aria-selected={isCurrent}
                            aria-controls={`demo-step-panel-${stepId}`}
                            tabIndex={isCurrent ? 0 : -1}
                            aria-label={`Step ${stepId}: ${stepData?.shortTitle}`}
                            onClick={() => {
                              setCurrentStep(stepId);
                            }}
                            className="group relative flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full p-1 sm:p-1.5 -m-1 sm:-m-1.5 cursor-pointer transition"
                          >
                            <span
                              className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs sm:text-sm font-mono font-bold transition duration-150 ${
                                isCurrent
                                  ? 'bg-ink text-white ring-2 ring-ink ring-offset-2 ring-offset-paper scale-105 shadow-xs'
                                  : isCompleted
                                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                  : 'bg-mist text-text-muted border border-line hover:border-ink hover:text-ink'
                              }`}
                            >
                              {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : stepId}
                            </span>
                          </button>

                          {/* Connecting line between nodes in the same chapter */}
                          {nodeIdx < chapter.stepIds.length - 1 && (
                            <div
                              className={`flex-1 h-0.5 mx-0.5 sm:mx-1.5 transition-colors ${
                                currentStep > stepId ? 'bg-emerald-400' : 'bg-line'
                              }`}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          <p className="gd-modal-guide-scroll-cue sm:hidden" aria-hidden="true">Swipe horizontally to see all steps</p>
        </div>

        {/* MAIN BODY AREA: ONLY ONE STEP DISPLAYED AT A TIME */}
        <div id={`demo-step-panel-${currentStep}`} role="tabpanel" aria-labelledby={`demo-step-tab-${currentStep}`} tabIndex={-1} className="gd-modal-body flex-1 min-h-0 px-4 py-2.5 sm:px-6 sm:py-3.5 relative text-ink focus:outline-none [scrollbar-width:thin] [scrollbar-color:var(--color-line)_transparent]">
          {/* STEP CONTENT CONTAINER - uses min-h-full and justify-start on mobile to prevent overflow clipping */}
          <div className="max-w-3xl mx-auto min-h-full flex flex-col justify-start md:justify-center py-0.5 sm:py-0">
            <div className="sr-only" aria-live="polite">Step {currentStep} of 7: {currentStepData.shortTitle}. {currentStep === 1 ? 'This is the first step.' : currentStep === 7 ? 'This is the last step.' : ''}</div>
            {/* STEP 1: OPEN ADVISING */}
            {currentStep === 1 && (
              <div id="demo-step-1" className="space-y-3 sm:space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-6 md:items-center">
                <div className="md:col-span-5 space-y-2">
                  <h3 className="text-xl sm:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed pt-1">
                    Go to your <strong className="font-bold text-ink">student portal</strong> and click <strong className="font-bold text-ink">Advising</strong>.
                  </p>
                </div>

                <div className="md:col-span-7 flex justify-center">
                  <div className="w-full max-w-[280px] sm:max-w-xs p-3 sm:p-5 bg-paper rounded-2xl border border-line flex flex-col items-center justify-center shadow-xs">
                    <img
                      src="/demo/step1-advising-icon.svg"
                      alt="Illustration of the student portal Advising entry point"
                      className="w-28 sm:w-40 max-h-[190px] sm:max-h-[220px] h-auto object-contain rounded-xl drop-shadow-xs"
                    />
                    <span className="mt-2 text-xs font-bold text-text-secondary uppercase tracking-wider">
                      Student Portal → Advising
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: CLEAR YOUR SCHEDULE */}
            {currentStep === 2 && (
              <div id="demo-step-2" className="space-y-3 sm:space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-6 md:items-center">
                <div className="md:col-span-5 space-y-2">
                  <h3 className="text-xl sm:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-sm sm:text-base font-bold text-ink leading-relaxed pt-1">
                    {COPY.demo.step2Body}
                  </p>
                  <p className="text-xs sm:text-sm text-text-secondary pt-0.5">
                    {COPY.demo.step2Note}
                  </p>
                </div>

                <div className="md:col-span-7">
                  <div className="w-full rounded-2xl overflow-hidden border border-line bg-paper shadow-xs p-2 sm:p-3">
                    <img
                      src="/demo/step2-registered-courses.svg"
                      alt="Schedule screenshot showing courses to drop"
                      className="w-full h-auto max-h-[200px] sm:max-h-[260px] object-contain rounded-xl"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: OPEN EACH COURSE */}
            {currentStep === 3 && (
              <div id="demo-step-3" className="space-y-3 sm:space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-6 md:items-center">
                <div className="md:col-span-5 space-y-2 sm:space-y-2.5">
                  <h3 className="text-xl sm:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                    {COPY.demo.step3Body1}
                  </p>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                    {COPY.demo.step3Body2}
                  </p>

                  {/* Course selection rule box with highlighted popup trigger */}
                  <div className="p-3 sm:p-3.5 rounded-xl bg-paper border-2 border-ink space-y-2">
                    <p className="text-xs sm:text-sm font-bold text-ink leading-snug">
                      {COPY.demo.step3Rule}
                    </p>
                  </div>
                </div>

                <div className="md:col-span-7">
                  <div className="w-full rounded-2xl overflow-hidden border border-line bg-paper shadow-xs p-2 sm:p-3">
                    <img
                      src="/demo/step4-course-options.svg"
                      alt="Course categories showing available options New07"
                      className="w-full h-auto max-h-[200px] sm:max-h-[260px] object-contain rounded-xl"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: TAKE A SCREENSHOT */}
            {currentStep === 4 && (
              <div id="demo-step-4" className="space-y-3 sm:space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-6 md:items-center">
                <div className="md:col-span-5 space-y-2 sm:space-y-2.5">
                  <h3 className="text-xl sm:text-2xl font-black text-ink tracking-tight pt-0.5">
                    {currentStepData.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                    {COPY.demo.step4Body}
                  </p>

                  <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line space-y-1.5">
                    <p className="text-xs font-extrabold text-ink uppercase tracking-wide">
                      Make sure it shows:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Course name</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Course code</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Days</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Times</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-7">
                  <div className="w-full rounded-2xl overflow-hidden border border-line bg-paper shadow-xs p-2 sm:p-3">
                    <img
                      src="/demo/step5-single-option-nutrition.svg"
                      alt="Single course option showing course name, code, days, and times"
                      className="w-full h-auto max-h-[220px] sm:max-h-[280px] object-contain rounded-xl"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: REPEAT FOR EVERY COURSE */}
            {currentStep === 5 && (
              <div id="demo-step-5" className="space-y-1.5 sm:space-y-2">
                <div className="space-y-0.5">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-black text-ink tracking-tight">
                    {currentStepData.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-text-secondary leading-snug">
                    {COPY.demo.step5Body1}
                    {COPY.demo.step5Body2}
                  </p>
                </div>

                {/* Screenshots: Side-by-side on desktop, stacked on mobile */}
                <div className="gd-demo-auto-grid grid grid-cols-1 gap-2 sm:gap-2.5">
                  <div className="rounded-xl overflow-hidden border border-line bg-paper shadow-xs p-1.5 space-y-0.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-black uppercase tracking-wider text-text-secondary">New07</span>
                      <span className="text-[11px] font-mono font-bold text-ink">Screenshot 1</span>
                    </div>
                    <img
                      src="/demo/step6-fin-new07.svg"
                      alt="Financial Management New07 option screenshot"
                      className="w-full h-auto max-h-[140px] sm:max-h-[180px] md:max-h-[210px] object-contain rounded-lg"
                    />
                  </div>

                  <div className="rounded-xl overflow-hidden border border-line bg-paper shadow-xs p-1.5 space-y-0.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-black uppercase tracking-wider text-text-secondary">New09</span>
                      <span className="text-[11px] font-mono font-bold text-ink">Screenshot 2</span>
                    </div>
                    <img
                      src="/demo/step6-fin-new09.svg"
                      alt="Financial Management New09 option screenshot"
                      className="w-full h-auto max-h-[140px] sm:max-h-[180px] md:max-h-[210px] object-contain rounded-lg"
                    />
                  </div>
                </div>

                <p className="text-xs text-text-secondary">
                  {COPY.demo.step5Body3}
                </p>
              </div>
            )}

            {/* STEP 6: SUMMARY */}
            {currentStep === 6 && (
              <div id="demo-step-6" className="w-full max-w-3xl mx-auto space-y-2.5 sm:space-y-3 py-1">
                <div className="text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-black text-ink tracking-tight">
                    6. Summary
                  </h3>
                </div>

                {/* 4 Parallel Rows on desktop (Step 1 || Step 2, Step 3 || Step 4, Step 5 || Step 6, Step 7 || Simple rule) */}
                <div className="space-y-2 sm:space-y-2.5 text-sm">
                  {/* Row 1: Step 1 and Step 2 */}
                  <div className="gd-demo-auto-grid grid grid-cols-1 gap-2 sm:gap-3">
                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">1. Open Advising</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        {COPY.demo.step1Body}
                      </p>
                    </div>

                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">2. Clear your schedule</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Drop/remove the courses currently in your schedule.
                      </p>
                    </div>
                  </div>

                  {/* Row 2: Step 3 and Step 4 */}
                  <div className="gd-demo-auto-grid grid grid-cols-1 gap-2 sm:gap-3">
                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">3. Choose your courses</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Click <strong className="font-bold text-ink">Add Courses</strong> and select <strong className="font-bold text-ink">every course you are willing to take this semester</strong>.
                      </p>
                    </div>

                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">4. Open each course</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Select a course to see its available options, such as <strong className="font-bold text-ink font-mono">New07</strong> or <strong className="font-bold text-ink font-mono">New09</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Row 3: Step 5 and Step 6 */}
                  <div className="gd-demo-auto-grid grid grid-cols-1 gap-2 sm:gap-3">
                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">5. Screenshot each option</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Open each option <strong className="font-bold text-ink">one at a time</strong> and take a screenshot. Make sure you can see the <strong className="font-bold text-ink">course name, course code, days, and times</strong>.
                      </p>
                    </div>

                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">6. Repeat for every course</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Screenshot <strong className="font-bold text-ink">every available option</strong> for every course you chose.<br />
                        Example: <strong className="font-bold text-ink font-mono">New07 = 1 screenshot, New09 = 1 screenshot</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Row 4: Step 7 and Simple Rule Banner */}
                  <div className="gd-demo-auto-grid grid grid-cols-1 gap-2 sm:gap-3">
                    <div className="p-2.5 sm:p-3 rounded-xl bg-paper border border-line shadow-2xs flex flex-col justify-center">
                      <h4 className="font-extrabold text-ink text-sm sm:text-base">7. Upload your screenshots</h4>
                      <p className="text-text-secondary text-xs sm:text-sm mt-0.5 leading-relaxed">
                        Upload all your screenshots to <strong className="font-bold text-ink">Gadwal</strong>.
                      </p>
                    </div>

                    <div className="p-2.5 sm:p-3 rounded-xl bg-mist border-2 border-ink flex items-center">
                      <p className="text-xs sm:text-sm font-bold text-ink leading-snug">
                        <strong>Simple rule: Choose the courses you want, screenshot every option, then upload them.</strong>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 7: FINISH (UPLOAD YOUR SCREENSHOTS) */}
            {currentStep === 7 && (
              <div id="demo-step-7" className="max-w-xl mx-auto space-y-4 text-center py-6 sm:py-8">
                <h3 className="text-2xl sm:text-3xl font-black text-ink tracking-tight pt-1">
                  {currentStepData.title}
                </h3>
                <p className="text-sm sm:text-base text-text-secondary leading-relaxed max-w-md mx-auto">
                  {COPY.demo.step7Body}
                </p>
                <p className="text-base sm:text-xl font-black text-ink pt-1">
                  {COPY.demo.step7Ending}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM NAVIGATION BAR */}
        <div className="gd-modal-footer flex items-center justify-between gap-2 sm:gap-3 z-20">
          {/* Previous Button */}
          <button
            type="button"
            id="demo-modal-prev"
            onClick={goToPrev}
            disabled={currentStep === 1}
            className={`min-h-[40px] px-3 sm:px-4 rounded-xl font-bold text-xs sm:text-sm inline-flex items-center gap-1 sm:gap-1.5 transition cursor-pointer ${
              currentStep === 1
                ? 'opacity-40 text-text-muted cursor-not-allowed border border-transparent'
                : 'text-ink hover:bg-mist border border-line active:scale-98'
            }`}
            aria-label="Previous step"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          {/* Center Progress Indicator */}
          <div className="text-center">
            <span className="text-xs font-mono font-bold text-text-secondary tracking-wide whitespace-nowrap">
              STEP {currentStep} OF 7
            </span>
          </div>

          {/* Next or Done Button */}
          {currentStep < 7 ? (
            <button
              type="button"
              id="demo-modal-next"
              onClick={goToNext}
              className="min-h-[40px] px-3.5 sm:px-5 rounded-xl bg-ink hover:bg-ink-soft text-white font-bold text-xs sm:text-sm inline-flex items-center gap-1 sm:gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
              aria-label="Next step"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              id="demo-modal-btn-action"
              onClick={handleAction}
              className="min-h-[40px] px-4 sm:px-6 rounded-xl bg-ink hover:bg-ink-soft text-white font-bold text-xs sm:text-sm inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
              aria-label="Upload screenshots"
            >
              <span>Upload your screenshots</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
