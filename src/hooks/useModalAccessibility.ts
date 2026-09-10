import React, { useEffect, useRef, RefObject } from 'react';
import { getTopOverlay, registerOverlay, unregisterOverlay } from './overlayRegistry';

interface UseModalAccessibilityOptions {
  isOpen: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  manageHistory?: boolean;
}

let activeLockCount = 0;
let previousBodyOverflow = '';
let previousBodyPaddingRight = '';
let previousBodyPosition = '';
let previousBodyTop = '';
let previousBodyWidth = '';
let previousScrollY = 0;

interface InertSnapshot { inert: boolean; ariaHidden: string | null; }
const inertedElements = new Map<HTMLElement, InertSnapshot>();

function setElementInert(element: HTMLElement, inert: boolean) {
  const target = element as HTMLElement & { inert?: boolean };
  target.inert = inert;
}

function refreshBackgroundInert() {
  if (typeof document === 'undefined') return;
  const topOverlay = getTopOverlay();
  const root = document.getElementById('root');
  const overlayRoot = document.getElementById('gadwal-overlay-root');
  if (!root) return;

  if (!topOverlay || topOverlay.kind !== 'modal') {
    for (const [element, snapshot] of inertedElements) {
      setElementInert(element, snapshot.inert);
      if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
    inertedElements.clear();
    return;
  }

  // The application shell and any other body-level content are the only background
  // regions that need isolation. The modal lives in the dedicated overlay root.
  const protectedTopLevel = new Set<Element>();
  if (overlayRoot) protectedTopLevel.add(overlayRoot);
  const bodyChildren = Array.from(document.body.children);
  for (const node of bodyChildren) {
    if (protectedTopLevel.has(node)) continue;
    const element = node as HTMLElement;
    if (!inertedElements.has(element)) {
      inertedElements.set(element, {
        inert: Boolean((element as HTMLElement & { inert?: boolean }).inert),
        ariaHidden: element.getAttribute('aria-hidden'),
      });
    }
    setElementInert(element, true);
    element.setAttribute('aria-hidden', 'true');
  }
}

export function resetBodyScrollLock() {
  if (typeof document === 'undefined') return;
  activeLockCount = 0;
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  for (const [element, snapshot] of inertedElements) {
    setElementInert(element, snapshot.inert);
    if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', snapshot.ariaHidden);
  }
  inertedElements.clear();
}

function lockScroll() {
  if (typeof document === 'undefined') return;
  if (activeLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingRight = document.body.style.paddingRight;
    previousBodyPosition = document.body.style.position;
    previousBodyTop = document.body.style.top;
    previousBodyWidth = document.body.style.width;
    previousScrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    document.body.style.overflow = 'hidden';
    if (window.matchMedia?.('(max-width: 639px)').matches) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${previousScrollY}px`;
      document.body.style.width = '100%';
    }
  }
  activeLockCount++;
}

function unlockScroll() {
  if (typeof document === 'undefined') return;
  activeLockCount = Math.max(0, activeLockCount - 1);
  if (activeLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow || '';
    document.body.style.paddingRight = previousBodyPaddingRight || '';
    document.body.style.position = previousBodyPosition || '';
    document.body.style.top = previousBodyTop || '';
    document.body.style.width = previousBodyWidth || '';
    if (window.matchMedia?.('(max-width: 639px)').matches) window.scrollTo({ top: previousScrollY, left: 0, behavior: 'auto' });
  }
}

export function useModalAccessibility<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  initialFocusRef,
  restoreFocusRef,
  // gadwalModal policy: manageHistory = true for transient modal Back handling.
  manageHistory = true,
}: UseModalAccessibilityOptions) {
  const modalRef = useRef<T>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef<string>('gadwal_modal_' + Math.random().toString(36).slice(2, 10));
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const id = modalIdRef.current;
    previousActiveElementRef.current = restoreFocusRef?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const overlayId = registerOverlay({
      id,
      kind: 'modal',
      priority: 100,
      close: () => onCloseRef.current(),
    });
    lockScroll();
    if (modalRef.current) modalRef.current.setAttribute('data-gadwal-overlay-id', id);
    refreshBackgroundInert();

    const focusFrame = window.requestAnimationFrame(() => {
      if (getTopOverlay()?.id !== overlayId) return;
      const target = initialFocusRef?.current || modalRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || modalRef.current;
      if (target && target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
      refreshBackgroundInert();
      const scrollBody = modalRef.current?.querySelector<HTMLElement>('.gd-modal-body');
      if (scrollBody) {
        const updateOverflow = () => {
          scrollBody.toggleAttribute('data-scroll-overflow', scrollBody.scrollHeight > scrollBody.clientHeight + 1);
          scrollBody.toggleAttribute('data-scroll-top', scrollBody.scrollTop > 1);
          scrollBody.toggleAttribute('data-scroll-bottom', scrollBody.scrollTop + scrollBody.clientHeight < scrollBody.scrollHeight - 1);
        };
        updateOverflow();
        scrollBody.addEventListener('scroll', updateOverflow, { passive: true });
        (modalRef.current as HTMLElement & { __gadwalScrollCleanup?: () => void }).__gadwalScrollCleanup = () => scrollBody.removeEventListener('scroll', updateOverflow);
      }
    });

    const handleTab = (event: KeyboardEvent) => {
      const isTop = getTopOverlay()?.id === overlayId;
      if (!isTop || !modalRef.current || event.key !== 'Tab') return;
      const elements = modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      const focusable = (Array.from(elements) as HTMLElement[]).filter((el) => el.isConnected && (el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0));
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey ? (document.activeElement === first || !modalRef.current.contains(document.activeElement)) : (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleTab, true);

    // Transient modals deliberately do not create synthetic history entries.
    // When a caller opts into modal history, browser Back closes the modal rather
    // than competing with the app's canonical route/hash history owner.
    const handlePopState = () => {
      if (!manageHistory || getTopOverlay()?.id !== overlayId) return;
      onCloseRef.current();
    };
    if (manageHistory) window.addEventListener('popstate', handlePopState, true);
    refreshBackgroundInert();

    return () => {
      window.cancelAnimationFrame(focusFrame);
      (modalRef.current as (HTMLElement & { __gadwalScrollCleanup?: () => void }) | null)?.__gadwalScrollCleanup?.();
      unlockScroll();
      document.removeEventListener('keydown', handleTab, true);
      if (manageHistory) window.removeEventListener('popstate', handlePopState, true);
      unregisterOverlay(overlayId);
      modalRef.current?.removeAttribute('data-gadwal-overlay-id');
      refreshBackgroundInert();

      const previous = restoreFocusRef?.current || previousActiveElementRef.current;
      window.requestAnimationFrame(() => {
        // If another overlay replaced this one, it owns focus.
        if (getTopOverlay()?.kind === 'modal') return;
        if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
        else document.body?.focus?.({ preventScroll: true });
      });
    };
  }, [isOpen, initialFocusRef, restoreFocusRef]);



  return modalRef;
}
