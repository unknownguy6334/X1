import React, { useState, useRef } from 'react';
import { usePopupInteractions } from '../hooks/usePopupInteractions';
import { RotateCcw, Menu, X, WifiOff } from 'lucide-react';
import { AppStep } from '../types';

interface HeaderProps {
  totalCoursesCount: number;
  currentStep?: AppStep;
  onNavigateStep?: (step: AppStep) => void;
  onGoHome: () => void;
  onReset: () => void;
  onOpenPromise: (trigger?: HTMLElement | null) => void;
  onOpenHowItWorks: (trigger?: HTMLElement | null) => void;
  onOpenDemo?: (trigger?: HTMLElement | null) => void;
  isOnline?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  totalCoursesCount,
  currentStep,
  onNavigateStep,
  onGoHome,
  onReset,
  onOpenPromise,
  onOpenHowItWorks,
  onOpenDemo,
  isOnline = true,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  usePopupInteractions({
    isOpen: isMobileMenuOpen,
    onClose: () => setIsMobileMenuOpen(false),
    triggerRef: toggleButtonRef,
    popupRef: popoverRef,
    keyboardNavigation: 'none',
    focusSelector: 'a, button, [tabindex]:not([tabindex="-1"])',
  });

  return (
    <header className="border-b border-line-strong bg-paper sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Side: Brand Identity (Navigates Home/Setup safely without resetting) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a
            href="/#home"
            id="header-btn-logo"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex items-center p-1 rounded-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent select-none cursor-pointer shrink-0"
            title="Gadwal home"
            aria-label="Return to Gadwal home"
          >
            <img
              src="/brand/gadwal-wordmark.png"
              alt="Gadwal"
              className="block w-auto h-9 sm:h-11 max-w-[10.5rem] sm:max-w-[13rem] object-contain object-left"
            />
          </a>

          {!isOnline && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-semibold text-caution-strong bg-caution-soft border border-caution-line rounded-xs select-none"
              title="You’re offline. Scheduling and exports still work."
            >
              <WifiOff className="w-3.5 h-3.5 text-caution" />
              <span>Working offline</span>
            </span>
          )}
        </div>

        {/* Desktop Navigation (sm: and up) text-led, underline on hover, no icon-per-item */}
        <div className="responsive-header-desktop items-center gap-6 shrink-0">
          <nav className="flex items-center gap-4 pr-1" aria-label="Main Navigation">
            <button
                type="button"
                id="header-btn-home"
                onClick={onGoHome}
                className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
                title="Return to home"
                aria-current={currentStep === 'home' ? 'page' : undefined}
              >
                Home
              </button>

            {currentStep === 'home' && totalCoursesCount > 0 && onNavigateStep && (
              <button
                type="button"
                id="header-btn-build"
                onClick={() => onNavigateStep('setup')}
                className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
                title="Go to course builder"
              >
                Build a week
              </button>
            )}

            <a
              href="#guide"
              id="header-btn-demo"
              onClick={(event) => { event.preventDefault(); onOpenDemo?.(event.currentTarget); }}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="Open screenshot guide"
            >
              Screenshot guide
            </a>
            <a
              href="#how-it-works"
              id="header-btn-how-it-works"
              onClick={(event) => { event.preventDefault(); onOpenHowItWorks(event.currentTarget); }}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="See how it works"
            >
              How it works
            </a>

            <a
              href="#promise"
              id="header-btn-promise"
              onClick={(event) => { event.preventDefault(); onOpenPromise(event.currentTarget); }}
              className="text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="Our Promise"
            >
              Our promise
            </a>
          </nav>

          {totalCoursesCount > 0 && (
            <button
              type="button"
              id="header-btn-reset"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 text-base font-semibold text-text-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap pb-0.5 border-b border-transparent hover:border-ink"
              title="Clear courses and start over"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Mobile navigation with the standard menu button */}
        <div className="responsive-header-mobile items-center gap-2 relative">
          <button
            ref={toggleButtonRef}
            type="button"
            id="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="responsive-header-menu-button inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-ink bg-white border border-line rounded-xl transition cursor-pointer active:scale-98"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-navigation-menu"
          >
            {isMobileMenuOpen ? (
              <>
                <X className="w-5 h-5 text-ink" />
              </>
            ) : (
              <>
                <Menu className="w-5 h-5 text-ink" />
              </>
            )}
          </button>

          {/* Mobile Popover Menu */}
          {isMobileMenuOpen && (
            <nav
              ref={popoverRef}
              id="mobile-navigation-menu"
              className="absolute right-0 top-full mt-2 w-60 bg-white border border-line rounded-sm shadow-md p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-0.5 focus:outline-none"
              aria-label="Mobile navigation"
            >
              <button
                  type="button"
                  id="mobile-menu-home"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onGoHome();
                  }}
                  className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
                >
                  Home
                </button>

              {currentStep === 'home' && totalCoursesCount > 0 && onNavigateStep && (
                <button
                  type="button"
                  id="mobile-menu-build"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onNavigateStep('setup');
                  }}
                  className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
                >
                  Build a week
                </button>
              )}

              <button
                type="button"
                id="mobile-menu-demo"
                onClick={() => {
                  onOpenDemo?.(toggleButtonRef.current);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                Screenshot guide
              </button>


              <button
                type="button"
                id="mobile-menu-how-it-works"
                onClick={() => {
                  onOpenHowItWorks(toggleButtonRef.current);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                How it works
              </button>

              <button
                type="button"
                onClick={() => {
                  onOpenPromise(toggleButtonRef.current);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-ink-soft hover:bg-mist rounded-sm transition text-left cursor-pointer"
              >
                Our promise
              </button>



              {totalCoursesCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onReset();
                  }}
                  className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center text-base font-semibold text-alert-strong hover:bg-alert-soft rounded-sm transition text-left cursor-pointer"
                >
                  Clear courses
                </button>
              )}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};
