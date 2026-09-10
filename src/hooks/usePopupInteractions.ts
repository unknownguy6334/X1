import { useEffect, useRef, type RefObject } from 'react';
import { getTopOverlay, registerOverlay, unregisterOverlay } from './overlayRegistry';

interface UsePopupInteractionsOptions {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  priority?: number;
  focusSelector?: string;
  keyboardNavigation?: 'menu' | 'none';
}

export function usePopupInteractions({
  isOpen,
  onClose,
  triggerRef,
  popupRef,
  priority = 50,
  focusSelector = '[role="menuitem"]',
  keyboardNavigation = 'menu',
}: UsePopupInteractionsOptions) {
  const onCloseRef = useRef(onClose);
  const overlayIdRef = useRef<string | null>(null);
  const previousFocusedRef = useRef<HTMLElement | null>(null);
  const itemIndexRef = useRef(0);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlayIdRef.current = registerOverlay({
      kind: priority >= 100 ? 'modal' : 'menu',
      priority,
      close: () => onCloseRef.current(),
    });

    const focusTimer = window.setTimeout(() => {
      const first = popupRef.current?.querySelector<HTMLElement>(focusSelector);
      first?.focus();
      itemIndexRef.current = 0;
    }, 0);

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      if (popupRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const overlay = overlayIdRef.current ? getTopOverlay() : null;
      if (!overlay || overlay.id !== overlayIdRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (!popupRef.current || keyboardNavigation !== 'menu') return;
      const target = event.target as HTMLElement | null;
      const role = target?.getAttribute('role') || popupRef.current.getAttribute('role');
      const items = Array.from(popupRef.current.querySelectorAll<HTMLElement>(`${focusSelector}:not([disabled])`));
      if (!items.length) return;
      if ((event.key === 'Enter' || event.key === ' ') && role === 'menuitem') {
        event.preventDefault();
        target?.click();
        return;
      }
      let next = itemIndexRef.current;
      if (event.key === 'ArrowDown') next = (next + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (next - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      itemIndexRef.current = next;
      items[next].focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (overlayIdRef.current) unregisterOverlay(overlayIdRef.current);
      overlayIdRef.current = null;
      window.requestAnimationFrame(() => {
        const trigger = triggerRef.current;
        if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
        else if (previousFocusedRef.current?.isConnected) previousFocusedRef.current.focus({ preventScroll: true });
      });
    };
  }, [isOpen, popupRef, triggerRef, priority, focusSelector, keyboardNavigation]);
}
