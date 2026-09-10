import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePopupInteractions } from '../hooks/usePopupInteractions';
import { Download, FileText, Image as ImageIcon, Copy, ChevronDown, Loader2 } from 'lucide-react';
import { OptimizationResult } from '../types';
import {
  downloadSchedulePDF,
  downloadScheduleImage,
  formatScheduleAsText,
  copyToClipboardDetailed,
} from '../utils/export';

interface ScheduleExportMenuProps {
  schedule: OptimizationResult;
  rank: number;
}

export const ScheduleExportMenu: React.FC<ScheduleExportMenuProps> = ({ schedule, rank }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'pdf' | 'image' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<'below' | 'above'>('below');

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    exportControllerRef.current?.abort();
  }, []);

  usePopupInteractions({
    isOpen,
    onClose: () => setIsOpen(false),
    triggerRef: buttonRef,
    popupRef: menuRef,
    focusSelector: '[role="menuitem"]',
    keyboardNavigation: 'menu',
  });

  const focusMenuItem = useCallback((index: number) => {
    const menu = menuRef.current?.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    const target = items[Math.max(0, Math.min(index, items.length - 1))];
    const first = items[0];
    target?.focus();
    if (index === 0) first?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => focusMenuItem(0));
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, focusMenuItem]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const updatePlacement = () => {
      const button = buttonRef.current;
      const menu = menuRef.current?.querySelector<HTMLElement>('[role="menu"]');
      if (!button || !menu) return;
      const rect = button.getBoundingClientRect();
      const menuHeight = Math.min(menu.scrollHeight, Math.max(240, window.innerHeight * 0.72));
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      setMenuPlacement(spaceBelow < Math.min(360, menuHeight) && spaceAbove > spaceBelow ? 'above' : 'below');
    };
    const frame = window.requestAnimationFrame(updatePlacement);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isOpen]);

  const handleDownloadPDF = async () => {
    const controller = new AbortController();
    exportControllerRef.current = controller;
    try {
      setErrorMessage(null);
      setExportProgress(0);
      setLoadingAction('pdf');
      await downloadSchedulePDF(schedule, rank, { signal: controller.signal, onProgress: setExportProgress });
      setIsOpen(false);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('PDF export failed', err);
        setErrorMessage('We couldn’t make the PDF. Try again.');
      } else {
        setErrorMessage('PDF export stopped.');
      }
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
      setLoadingAction(null);
      setExportProgress(0);
    }
  };

  const handleDownloadImage = async () => {
    const controller = new AbortController();
    exportControllerRef.current = controller;
    try {
      setErrorMessage(null);
      setExportProgress(0);
      setLoadingAction('image');
      await downloadScheduleImage(schedule, rank, { signal: controller.signal, onProgress: setExportProgress });
      setIsOpen(false);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Image export failed', err);
        setErrorMessage('We couldn’t save the image. Try again.');
      } else {
        setErrorMessage('Image export stopped.');
      }
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
      setLoadingAction(null);
      setExportProgress(0);
    }
  };

  const handleCancelExport = () => {
    exportControllerRef.current?.abort();
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        id={`btn-export-schedule-${rank}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={`schedule-export-menu-${rank}`}
        aria-label={`More actions for schedule ${rank}`}
        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-[44px] bg-white hover:bg-mist border border-line-strong hover:border-ink rounded-sm text-sm font-bold text-ink transition cursor-pointer active:scale-98 shadow-2xs"
      >
        <Download className="w-3.5 h-3.5 text-ink-soft" aria-hidden="true" />
        <span>More</span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="menu"
          id={`schedule-export-menu-${rank}`}
          aria-orientation="vertical"
          aria-labelledby={`btn-export-schedule-${rank}`}
          onKeyDown={handleMenuKeyDown}
          className={`absolute right-0 w-56 max-w-[calc(100vw-2rem)] max-h-[72vh] overflow-y-auto bg-white border border-line-strong rounded-sm shadow-lg z-30 py-1 divide-y divide-line animate-in fade-in zoom-in-95 duration-100 ${menuPlacement === 'above' ? 'bottom-full mb-1.5' : 'mt-1.5'}`}
        >
          <div className="py-1">
            <div className="px-3.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Export</div>
            <button tabIndex={0} type="button" role="menuitem" disabled={loadingAction !== null} onClick={handleDownloadPDF} className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-ink hover:bg-mist flex items-center gap-2.5 transition cursor-pointer disabled:opacity-40">
              {loadingAction === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin text-red-600"/> : <FileText className="w-4 h-4 text-red-600" aria-hidden="true"/>}
              <span>{loadingAction === 'pdf' ? 'Making your PDF…' : 'Download as PDF'}</span>
            </button>
            <button tabIndex={0} type="button" role="menuitem" disabled={loadingAction !== null} onClick={handleDownloadImage} className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-ink hover:bg-mist flex items-center gap-2.5 transition cursor-pointer disabled:opacity-40">
              {loadingAction === 'image' ? <Loader2 className="w-4 h-4 animate-spin text-blue-600"/> : <ImageIcon className="w-4 h-4 text-blue-600" aria-hidden="true"/>}
              <span>{loadingAction === 'image' ? 'Making your image…' : 'Download as image'}</span>
            </button>
            <button tabIndex={0} type="button" role="menuitem" onClick={() => {
              try {
                const text = formatScheduleAsText(schedule, rank);
                const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href=url; a.download=`gadwal-schedule-${rank}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); setIsOpen(false);
              } catch (err) { console.error('Text export failed', err); setErrorMessage('We couldn’t download the text file. Try again.'); }
            }} className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-ink hover:bg-mist flex items-center gap-2.5 transition cursor-pointer">
              <Copy className="w-4 h-4 text-emerald-600" aria-hidden="true"/>
              <span>Download as text</span>
            </button>
          </div>

          {loadingAction !== null && (
            <div className="border-t border-line px-3 py-2 bg-paper">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-sm font-mono text-text-muted" aria-live="polite">
                  {loadingAction === 'pdf' ? 'Making your PDF' : 'Making your image'} · {Math.round(exportProgress * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="text-sm font-bold text-red-600 hover:text-red-800 underline"
                >
                  Cancel
                </button>
              </div>
              <div className="h-1.5 bg-line rounded-full overflow-hidden" aria-hidden="true">
                <div className="h-full bg-emerald-600 transition-[width] duration-100" style={{ width: `${Math.round(exportProgress * 100)}%` }} />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 border-t border-red-200" role="alert" aria-live="assertive">
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
