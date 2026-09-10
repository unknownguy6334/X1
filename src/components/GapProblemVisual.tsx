import React from 'react';
import { ArrowRight } from 'lucide-react';

export const GapProblemVisual: React.FC = () => {
  return (
    <div
      className="w-full border border-line bg-white rounded-xl p-4 sm:p-5 lg:p-6"
      aria-label="A class at 10 AM followed by a three hour gap before the next class at 1 PM"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs sm:text-sm font-black uppercase tracking-[0.14em] text-text-muted">The gap</span>
        <span className="font-mono text-sm sm:text-base font-bold text-alert-strong">3 hours</span>
      </div>

      <div className="mt-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs sm:text-sm font-bold text-text-muted">10:00 AM</p>
          <p className="mt-1 text-sm sm:text-base font-extrabold text-ink">Class</p>
        </div>

        <div className="min-w-0" aria-hidden="true">
          <div className="flex items-center gap-2">
            <div className="h-px w-full bg-line-strong" />
            <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
          </div>
          <div className="mt-2 border-y border-line py-4 sm:py-5 text-center bg-mist">
            <p className="font-mono text-lg sm:text-2xl font-black text-ink">10:00 → 1:00</p>
            <p className="mt-1 text-xs sm:text-sm font-semibold text-alert-strong">waiting on campus</p>
          </div>
        </div>

        <div className="text-right min-w-0">
          <p className="font-mono text-xs sm:text-sm font-bold text-text-muted">1:00 PM</p>
          <p className="mt-1 text-sm sm:text-base font-extrabold text-ink">Class</p>
        </div>
      </div>

      <p className="mt-5 text-sm sm:text-base leading-relaxed text-text-secondary">
        Gadwal looks through the available sections and finds combinations that cut down this empty time.
      </p>
    </div>
  );
};
