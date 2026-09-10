import React from 'react';
import { X, Check } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { COPY } from '../content/copy';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({ isOpen, onClose, onGetStarted, restoreFocusRef }) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef , manageHistory: false });
  if (!isOpen) return null;

  const handleAction = () => {
    if (onGetStarted) { onGetStarted(); return; }
    onClose();
    const dropzone = document.getElementById('upload-dropzone') || document.getElementById('step-add-courses-container');
    dropzone?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-5 motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-it-works-title"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-sheet sm:max-w-3xl flex flex-col text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="gd-modal-header">
          <div className="min-w-0 pr-3">
            <h2 id="how-it-works-title" className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              {COPY.how.title}
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary font-medium mt-0.5 leading-snug">
              You choose the courses. Gadwal checks the combinations.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close how Gadwal works information"
            className="gd-modal-close shrink-0"
          >
            <X className="w-5 h-5 text-text-secondary" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <div className="gd-modal-body px-5 sm:px-7 py-6 sm:py-7 space-y-8" data-modal-scroll>
          {/* Section 1: Courses & section options */}
          <section className="space-y-4">
            <div>
              <p className="text-[11px] sm:text-xs font-black tracking-[0.14em] uppercase text-text-secondary">01</p>
              <h3 className="text-base sm:text-lg font-black text-ink tracking-tight mt-1">
                1. You choose the courses
              </h3>
            </div>

            <div>
              <h4 className="text-sm sm:text-base font-bold text-ink">Each course has options</h4>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mt-1">
                {COPY.how.sections}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {[
                { label: 'Course A', count: '1 option', options: ['ACT20101'] },
                { label: 'Course B', count: '2 options', options: ['ECN33104', 'ECN33106'] },
                { label: 'Course C', count: '3 options', options: ['FIN32101', 'FIN32102', 'FIN32103'] },
              ].map((course) => (
                <div key={course.label} className="rounded-lg border border-line bg-paper p-3 sm:p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs sm:text-sm font-black text-ink">{course.label}</p>
                    <span className="text-[11px] font-bold text-text-secondary">{course.count}</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {course.options.map((option) => (
                      <div key={option} className="px-2 py-1.5 rounded-md bg-white border border-line font-mono text-xs font-bold text-ink">
                        {option}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4 border-t border-line pt-7">
            <div>
              <p className="text-[11px] sm:text-xs font-black tracking-[0.14em] uppercase text-text-secondary">02</p>
              <h3 className="text-base sm:text-lg font-black text-ink tracking-tight mt-1">
                2. That creates a lot of combinations
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mt-1">
                {COPY.how.combinations}
              </p>
            </div>

            <div className="rounded-lg border border-line bg-paper p-3 sm:p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 font-mono text-xs font-bold text-ink">
                {[
                  'ACT20101 + ECN33104 + FIN32101',
                  'ACT20101 + ECN33104 + FIN32102',
                  'ACT20101 + ECN33104 + FIN32103',
                  'ACT20101 + ECN33106 + FIN32101',
                  'ACT20101 + ECN33106 + FIN32102',
                  'ACT20101 + ECN33106 + FIN32103',
                ].map((combo) => (
                  <div key={combo} className="px-2 py-2 rounded-md bg-white border border-line text-center whitespace-normal break-words">
                    {combo}
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-3 border-t border-line text-center">
                <p className="text-[11px] font-bold text-text-secondary tracking-[0.14em] uppercase">
                  ... multiplying across all sections ...
                </p>
                <div className="mt-2 inline-flex px-4 py-2 rounded-full bg-caution-soft border border-caution-line">
                  <span className="text-base sm:text-lg font-black text-caution-strong tracking-tight">
                    Hundreds of possibilities
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-line pt-5 text-center sm:text-left">
              <p className="text-sm sm:text-base text-text-secondary">{COPY.how.manual}</p>
              <p className="text-base sm:text-lg font-black text-ink mt-1">{COPY.how.handoff}</p>
            </div>
          </section>

          <section className="space-y-4 border-t border-line pt-7">
            <div>
              <p className="text-[11px] sm:text-xs font-black tracking-[0.14em] uppercase text-text-secondary">03</p>
              <h3 className="text-base sm:text-lg font-black text-ink tracking-tight mt-1">
                3. Gadwal searches the combinations
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary mt-1 leading-relaxed">
                {COPY.how.searches}
              </p>
            </div>

            <ul className="space-y-2.5" aria-label="What Gadwal looks for">
              {[COPY.how.fewerDays, COPY.how.lessGap, COPY.how.noConflicts].map((label) => (
                <li key={label} className="flex items-center gap-2.5 rounded-lg border border-success-line bg-success-soft px-3 py-3">
                  <span className="w-5 h-5 rounded-full bg-success-line text-success-strong grid place-items-center text-xs font-black shrink-0">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-success-strong">{label}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">Gadwal also applies the preferences you set, such as target credits, must-take courses, free days, and time limits.</p>
          </section>

          <section className="space-y-4 border-t border-line pt-7 pb-1">
            <div>
              <p className="text-[11px] sm:text-xs font-black tracking-[0.14em] uppercase text-text-secondary">04</p>
              <h3 className="text-base sm:text-lg font-black text-ink tracking-tight mt-1">
                4. You choose the one you like best
              </h3>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mt-1">
                {COPY.how.chooseBest}
              </p>
            </div>

            <div className="space-y-2">
              {[
                ['Schedule 1', '4 days · 5 hours of gaps · No conflicts'],
                ['Schedule 2', '4 days · 7 hours of gaps · No conflicts'],
                ['Schedule 3', '5 days · 3 hours of gaps · No conflicts'],
              ].map(([title, meta]) => (
                <div key={title} className="rounded-lg border border-line bg-paper p-3 text-xs sm:text-sm">
                  <p className="font-extrabold text-ink">{title}</p>
                  <p className="text-text-secondary font-medium mt-1">{meta}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-ink text-white px-3.5 py-3.5 mt-3">
              <p className="text-sm sm:text-base font-black leading-snug">
                You choose the schedule that works best for you.
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="gd-modal-footer gd-modal-action-row">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg border border-line-strong font-bold text-sm text-ink hover:bg-paper focus-visible:ring-2 focus-visible:ring-accent transition-colors cursor-pointer"
          >
            I understand
          </button>
          <button
            type="button"
            onClick={handleAction}
            className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg bg-ink text-white font-bold text-sm hover:bg-ink-soft focus-visible:ring-2 focus-visible:ring-accent transition-colors cursor-pointer"
          >
            {COPY.how.startAction}
          </button>
        </div>
      </div>
    </div>
  );
}
