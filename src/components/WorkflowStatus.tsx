import React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, RotateCcw, XCircle } from 'lucide-react';

export type WorkflowStatusKind = 'loading' | 'success' | 'partial' | 'empty' | 'warning' | 'error' | 'cancelled';

interface WorkflowStatusProps {
  kind: WorkflowStatusKind;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  compact?: boolean;
  autoFocus?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const ICONS = { loading: Loader2, success: CheckCircle2, partial: Info, empty: Info, warning: Info, error: AlertCircle, cancelled: XCircle } as const;

export const WorkflowStatus: React.FC<WorkflowStatusProps> = ({ kind, title, description, actionLabel, onAction, actionDisabled, secondaryActionLabel, onSecondaryAction, className = '', compact = false, autoFocus = false }) => {
  const Icon = ICONS[kind];
  const isErrorLike = kind === 'error' || kind === 'cancelled';
  return (
    <div
      role={isErrorLike ? 'alert' : 'status'}
      aria-live={isErrorLike ? 'assertive' : 'polite'}
      ref={containerRef}
      tabIndex={autoFocus ? -1 : undefined}
      autoFocus={autoFocus}
      className={`workflow-status workflow-status-${kind} ${compact ? 'workflow-status-compact' : ''} ${className}`.trim()}
    >
      <div className="workflow-status-icon" aria-hidden="true"><Icon className={`w-4 h-4 ${kind === 'loading' ? 'animate-spin' : ''}`} /></div>
      <div className="workflow-status-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
        {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
          <div className="workflow-status-actions">
            {actionLabel && onAction && (
              <button type="button" className="workflow-status-action min-h-[44px]" onClick={onAction} disabled={actionDisabled}>
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />{actionLabel}
              </button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button type="button" className="workflow-status-secondary-action" onClick={onSecondaryAction}>{secondaryActionLabel}</button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
