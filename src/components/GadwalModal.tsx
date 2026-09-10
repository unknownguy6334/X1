import React from 'react';
import { createPortal } from 'react-dom';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface GadwalModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  compact?: boolean;
  className?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

function getOverlayRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('gadwal-overlay-root');
}

export const GadwalModal: React.FC<GadwalModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  restoreFocusRef,
  compact = false,
  className = '',
  footer,
  children,
}) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, restoreFocusRef });
  if (!isOpen) return null;
  const root = getOverlayRoot();
  const content = (
    <div className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-5 motion-safe:animate-in motion-safe:fade-in duration-150" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gadwal-shared-modal-title"
        aria-describedby={description ? 'gadwal-shared-modal-description' : undefined}
        tabIndex={-1}
        className={`gd-modal-shell ${compact ? 'gd-modal-compact' : 'gd-modal-sheet'} flex flex-col text-ink ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gd-modal-header">
          <div className="min-w-0 pr-3">
            <h2 id="gadwal-shared-modal-title" className="text-lg sm:text-xl font-black text-ink tracking-tight">{title}</h2>
            {description && <p id="gadwal-shared-modal-description" className="text-xs sm:text-sm text-text-secondary mt-0.5 leading-snug">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="gd-modal-close shrink-0">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="gd-modal-body" data-modal-scroll>{children}</div>
        {footer && <div className="gd-modal-footer gd-modal-action-row">{footer}</div>}
      </div>
    </div>
  );
  return root ? createPortal(content, root) : content;
};
