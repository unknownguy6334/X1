import React from 'react';
import { ArrowRight } from 'lucide-react';
import { COPY } from '../content/copy';
import { StudentGapPosts } from './StudentGapPosts';
import { GapProblemVisual } from './GapProblemVisual';

interface HeroBannerProps {
  onGetStarted?: () => void;
  onOpenHowItWorks?: () => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ onGetStarted, onOpenHowItWorks }) => {
  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    const dropzone =
      document.getElementById('responsive-choice-section') ||
      document.getElementById('responsive-add-title') ||
      document.getElementById('upload-dropzone') ||
      document.getElementById('step-add-courses-container');
    dropzone?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section
      className="w-full bg-paper border-b border-line px-4 sm:px-6"
      aria-labelledby="hero-title"
      id="homepage-hero-section"
    >
      <div className="max-w-6xl mx-auto px-0 py-6 sm:py-8 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-10 xl:gap-14 items-center">
          <div className="lg:col-span-6 xl:col-span-6 max-w-2xl">
            <h1
              id="hero-title"
              className="font-sans text-3xl sm:text-4xl lg:text-[2.75rem] xl:text-[3.25rem] font-extrabold text-ink tracking-[-0.04em] leading-[1.08] text-balance"
            >
              {COPY.hero.title}
            </h1>

            <div className="mt-4 sm:mt-6 space-y-2 sm:space-y-3 text-sm sm:text-base text-text-secondary leading-relaxed">
              <p>{COPY.hero.question}</p>
              <p className="font-semibold text-ink">{COPY.hero.problem}</p>
              <p>{COPY.hero.empathy}</p>
              <p className="font-medium text-text-secondary">{COPY.hero.why}</p>
            </div>

            <div className="mt-4 sm:mt-6 flex flex-col gap-3 max-w-md">
              <button
                type="button"
                id="hero-btn-primary"
                onClick={handleGetStarted}
                className="w-full min-h-[52px] px-5 rounded-md bg-ink text-white text-base font-bold inline-flex items-center justify-center gap-2 hover:bg-ink-soft focus-visible:ring-2 focus-visible:ring-accent transition active:translate-y-px cursor-pointer"
              >
                <span>{COPY.hero.primary}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                id="hero-btn-how-it-works"
                aria-label="How it works"
                onClick={onOpenHowItWorks}
                className="self-start min-h-[44px] inline-flex items-center px-1 text-sm sm:text-base font-bold text-brand-green underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm transition-colors cursor-pointer"
              >
                {COPY.hero.guide}
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 xl:col-span-6 mt-8 lg:mt-0">
            <GapProblemVisual />
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto pb-7 sm:pb-9 lg:pb-10">
        <StudentGapPosts />
      </div>
    </section>
  );
};
