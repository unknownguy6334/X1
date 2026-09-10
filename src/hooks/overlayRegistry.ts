export type OverlayKind = 'modal' | 'menu' | 'dropdown' | 'tooltip';

export interface OverlayRegistration {
  id: string;
  kind: OverlayKind;
  priority: number;
  close: () => void;
}

const overlays: OverlayRegistration[] = [];
let sequence = 0;
let listenerInstalled = false;
let escapeListener: ((event: KeyboardEvent) => void) | null = null;

function orderedOverlays() {
  return [...overlays].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return overlays.indexOf(a) - overlays.indexOf(b);
  });
}

function ensureEscapeListener() {
  if (listenerInstalled || typeof document === 'undefined') return;
  escapeListener = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const top = orderedOverlays().at(-1);
    if (!top) return;
    event.preventDefault();
    event.stopPropagation();
    top.close();
  };
  document.addEventListener('keydown', escapeListener, true);
  listenerInstalled = true;
}

export function registerOverlay(input: Omit<OverlayRegistration, 'id'> & { id?: string }) {
  const entry: OverlayRegistration = {
    ...input,
    id: input.id || `gadwal_overlay_${++sequence}`,
  };
  // Higher-priority overlays own the interaction surface. Opening one closes
  // lower-priority transient popups so stale menus cannot retain focus/listeners.
  if (entry.priority >= 100) {
    for (const existing of [...overlays]) {
      if (existing.priority < entry.priority) existing.close();
    }
  } else if (entry.kind === 'menu' || entry.kind === 'dropdown') {
    for (const existing of [...overlays]) {
      if ((existing.kind === 'menu' || existing.kind === 'dropdown') && existing.id !== entry.id) existing.close();
    }
  }
  overlays.push(entry);
  ensureEscapeListener();
  return entry.id;
}

export function unregisterOverlay(id: string) {
  const index = overlays.findIndex((entry) => entry.id === id);
  if (index >= 0) overlays.splice(index, 1);
  if (overlays.length === 0 && listenerInstalled && typeof document !== 'undefined') {
    if (escapeListener) document.removeEventListener('keydown', escapeListener, true);
    escapeListener = null;
    listenerInstalled = false;
  }
}

export function getTopOverlay() {
  return orderedOverlays().at(-1) || null;
}

export function hasOverlayPriorityAtLeast(priority: number) {
  return orderedOverlays().some((entry) => entry.priority >= priority);
}

export function resetOverlayRegistryForTests() {
  overlays.splice(0, overlays.length);
  if (escapeListener && typeof document !== 'undefined') document.removeEventListener('keydown', escapeListener, true);
  escapeListener = null;
  listenerInstalled = false;
}
