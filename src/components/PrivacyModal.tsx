import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose , manageHistory: false });
  if (!isOpen) return null;

  return (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-modal-title"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-sheet sm:max-w-2xl flex flex-col text-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gd-modal-header">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-accent" aria-hidden="true" />
            <h2 id="privacy-modal-title" className="text-lg sm:text-xl font-bold text-ink tracking-tight">
              Your privacy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="gd-modal-close"
            aria-label="Close privacy information"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="gd-modal-body p-5 sm:p-6 space-y-5 text-sm text-text-secondary leading-relaxed">
          <p className="text-base font-semibold text-ink">
            Your schedule stays yours. Gadwal just helps you work with it.
          </p>

          <section className="rule pt-4 space-y-2">
            <h3 className="font-bold text-ink">When you upload screenshots</h3>
            <p>
              When you upload a screenshot, it is sent to Gadwal so we can read the course details. We send the results back for you to check.
            </p>
          </section>

          <section className="rule pt-4 space-y-2">
            <h3 className="font-bold text-ink">What Gadwal won’t do</h3>
            <p>
              Gadwal does not register classes or change your university account. Your courses and choices stay saved in your browser on this device.
            </p>
          </section>

          <section className="rule pt-4 space-y-2">
            <h3 className="font-bold text-ink">Check the course details</h3>
            <p>
              Screenshots can be misread. Check the course names, sections, days, times, and credits before building. Only upload screenshots you are comfortable sharing.
            </p>
          </section>

          <p className="text-sm text-text-muted">
            This page explains the main data handling used by Gadwal. For the current rules, use the published privacy policy.
          </p>
        </div>
      </div>
    </div>
  );
};
