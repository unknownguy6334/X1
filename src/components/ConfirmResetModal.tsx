import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface ConfirmResetModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
}

export const ConfirmResetModal: React.FC<ConfirmResetModalProps> = ({
  isOpen,
  open,
  onClose,
  onCancel,
  onConfirm,
  title = 'Clear your saved courses?',
  description = 'This clears the courses and preferences saved on this device. You can add them again later.',
  confirmLabel = 'Clear courses',
}) => {
  const isVisible = Boolean(isOpen ?? open);
  const handleClose = onClose || onCancel || (() => {});

  const modalRef = useModalAccessibility<HTMLDivElement>({
    isOpen: isVisible,
    onClose: handleClose,
  });

  if (!isVisible) return null;

  return (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 motion-safe:animate-in motion-safe:fade-in duration-150"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-reset-title"
        aria-describedby="confirm-reset-description"
        tabIndex={-1}
        className="gd-modal-shell gd-modal-compact p-6 text-center space-y-5 motion-safe:animate-in motion-safe:zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 text-red-600 flex items-center justify-center mx-auto shadow-xs">
          <AlertTriangle className="w-7 h-7 text-red-600" />
        </div>

        <div className="space-y-1.5">
          <h2 id="confirm-reset-title" className="text-xl font-bold text-ink tracking-tight">
            {title}
          </h2>
          <p id="confirm-reset-description" className="text-sm sm:text-sm text-text-secondary leading-relaxed">
            {description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            id="btn-cancel-reset"
            onClick={handleClose}
            className="py-2.5 px-4 min-h-[44px] flex items-center justify-center rounded-md bg-paper hover:bg-mist text-ink border border-line-strong text-sm sm:text-sm font-bold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            id="btn-confirm-reset"
            onClick={() => {
              onConfirm();
              handleClose();
            }}
            className="py-2.5 px-4 min-h-[44px] flex items-center justify-center rounded-md bg-red-600 hover:bg-red-700 text-white text-sm sm:text-sm font-bold transition cursor-pointer shadow-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
