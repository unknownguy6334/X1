import React from 'react';
import { X, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { COPY } from '../content/copy';

interface PromiseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGetStarted?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const PromiseModal: React.FC<PromiseModalProps> = ({ isOpen, onClose, onGetStarted, restoreFocusRef }) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef , manageHistory: false });
  if (!isOpen) return null;

  return (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-5 motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="promise-modal-title"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-sheet sm:max-w-2xl flex flex-col text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="gd-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 grid place-items-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            </div>
            <h2 id="promise-modal-title" className="text-lg sm:text-xl font-black text-ink tracking-tight">
              {COPY.promise.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close our promise"
            className="gd-modal-close"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content Body */}
        <div className="gd-modal-body px-5 sm:px-8 py-6 space-y-6 text-ink">
          {/* Core premise */}
          <div className="space-y-3">
            <p className="text-base sm:text-lg font-bold text-ink leading-snug">
              {COPY.promise.core}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.available}
            </p>
            <div className="p-3.5 sm:p-4 rounded-xl bg-caution-soft border border-caution-line text-caution-strong text-sm sm:text-base leading-relaxed font-medium">
              <strong className="font-bold text-ink">{COPY.promise.cannot}</strong>
            </div>
          </div>

          {/* Section: {COPY.promise.exampleHeading} */}
          <div className="p-4 sm:p-5 rounded-xl bg-paper border border-line space-y-3">
            <h3 className="text-base sm:text-lg font-black text-ink tracking-tight">
              {COPY.promise.exampleHeading}
            </h3>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.exampleIntro}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.exampleSpread}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.exampleImpossible}
            </p>
            <p className="text-sm sm:text-base font-semibold text-ink leading-relaxed">
              {COPY.promise.exampleTruth}
            </p>
          </div>

          {/* Section: Here's what Gadwal can do */}
          <div className="space-y-3.5">
            <h3 className="text-base sm:text-lg font-black text-ink tracking-tight">
              {COPY.promise.capabilityHeading}
            </h3>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.capabilityIntro}
            </p>

            {/* Comparison Cards: Manual vs Gadwal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Manual pick card */}
              <div className="p-4 rounded-xl bg-mist/60 border border-line flex flex-col justify-between">
                <div className="space-y-1.5 text-xs sm:text-sm text-text-secondary">
                  <p><strong className="text-ink">Monday:</strong> 2-hour gap</p>
                  <p><strong className="text-ink">Tuesday:</strong> 3-hour gap</p>
                  <p><strong className="text-ink">Wednesday:</strong> 1-hour gap</p>
                  <p><strong className="text-ink">Thursday:</strong> 5-hour gap</p>
                </div>
                <div className="mt-3 pt-2.5 border-t border-line">
                  <p className="text-xs sm:text-sm font-bold text-ink">
                    Total: 11 hours of gaps
                  </p>
                </div>
              </div>

              {/* Gadwal optimized card */}
              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between">
                <div className="space-y-1.5 text-xs sm:text-sm text-text-secondary">
                  <p><strong className="text-emerald-950">Monday:</strong> 1-hour gap</p>
                  <p><strong className="text-emerald-950">Tuesday:</strong> 1-hour gap</p>
                  <p><strong className="text-emerald-950">Wednesday:</strong> 1-hour gap</p>
                  <p><strong className="text-emerald-950">Thursday:</strong> 2-hour gap</p>
                </div>
                <div className="mt-3 pt-2.5 border-t border-emerald-200">
                  <p className="text-xs sm:text-sm font-black text-emerald-800">
                    Total: 5 hours of gaps
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm sm:text-base text-text-secondary leading-relaxed pt-1">
              {COPY.promise.gapChange}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.sectionsExist}
            </p>
          </div>

          {/* Section: What if the perfect schedule isn't possible? */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-black text-ink tracking-tight">
              {COPY.promise.impossibleHeading}
            </h3>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.okay}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.bestAvailable}
            </p>
            <div className="space-y-1.5 py-1">
              <p className="text-sm sm:text-base font-bold text-ink">
                11 hours of gaps → 5 hours
              </p>
              <p className="text-sm sm:text-base font-bold text-ink">
                6 days → 4 days
              </p>
              <p className="text-sm sm:text-base font-bold text-ink">
                Overlapping courses → no conflicts
              </p>
            </div>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.maybeNoImprovement}
            </p>
            <p className="text-sm sm:text-base font-bold text-ink leading-relaxed">
              {COPY.promise.depends}
            </p>
          </div>

          {/* Section: {COPY.promise.screenshotsHeading} */}
          <div className="p-4 sm:p-5 rounded-xl bg-paper border border-line space-y-3">
            <h3 className="text-base sm:text-lg font-black text-ink tracking-tight">
              {COPY.promise.screenshotsHeading}
            </h3>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.screenshotSource}
            </p>
            <p className="text-sm sm:text-base font-bold text-ink leading-relaxed">
              {COPY.promise.screenshotMissing}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.screenshotFresh}
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.screenshotUpdate}
            </p>
          </div>

          {/* Section: {COPY.promise.finalHeading} */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-black text-ink tracking-tight">
              {COPY.promise.finalHeading}
            </h3>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              <strong className="font-bold text-ink">{COPY.promise.finalNoRegister}</strong>
            </p>
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
              {COPY.promise.finalSearchOnly}
            </p>
            <p className="text-sm sm:text-base font-bold text-ink leading-relaxed">
              {COPY.promise.finalTruth}
            </p>
            <div className="space-y-1 py-1 text-sm sm:text-base text-ink">
              <p>{COPY.promise.finalYouChoose}</p>
              <p>{COPY.promise.finalSearch}</p>
              <p className="font-bold">{COPY.promise.finalDecision}</p>
            </div>
          </div>

          {/* Final Trust Callout */}
          <div className="p-4 sm:p-5 rounded-xl bg-emerald-50 border-2 border-emerald-300 shadow-2xs flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm sm:text-base font-bold text-emerald-950 leading-snug">
              {COPY.promise.finalTrust}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="gd-modal-footer gd-modal-action-row">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-xl border border-line-strong font-bold text-sm text-ink hover:bg-white transition-colors focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
          >
            I understand
          </button>
          {onGetStarted && (
            <button
              type="button"
              onClick={onGetStarted}
              className="min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-ink-soft shadow-xs focus-visible:ring-2 focus-visible:ring-accent transition-colors cursor-pointer"
            >
              <span>{COPY.promise.startAction}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
