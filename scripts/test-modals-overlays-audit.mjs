import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const files = {
  hook: read('src/hooks/useModalAccessibility.ts'),
  registry: read('src/hooks/overlayRegistry.ts'),
  popup: read('src/hooks/usePopupInteractions.ts'),
  stepAdd: read('src/components/StepAddCourses.tsx'),
  demo: read('src/components/DemoModal.tsx'),
  header: read('src/components/Header.tsx'),
  exportMenu: read('src/components/ScheduleExportMenu.tsx'),
  app: read('src/App.tsx'),
  css: read('src/index.css'),
  index: read('index.html'),
};
let pass=0,total=0;
function check(name, ok){ total++; if(ok){pass++; console.log(`PASS: ${name}`)} else console.error(`FAIL: ${name}`); }

check('Shared overlay registry exists', files.registry.includes('registerOverlay') && files.registry.includes('getTopOverlay'));
check('Shared popup interaction hook exists', files.popup.includes('usePopupInteractions') && files.popup.includes('registerOverlay'));
check('Modal hook uses shared overlay registry', files.hook.includes("from './overlayRegistry'") && files.hook.includes('registerOverlay'));
check('Modal hook has deliberate transient history policy', files.hook.includes('manageHistory = true') && files.hook.includes('gadwalModal'));
check('Modal hook handles browser Back by closing transient modal', files.hook.includes("window.addEventListener('popstate', handlePopState, true)") && files.hook.includes('onCloseRef.current()'));
check('Modal hook compensates desktop scrollbar width', files.hook.includes('innerWidth - document.documentElement.clientWidth') && files.hook.includes('paddingRight'));
check('Modal hook has mobile fixed-body scroll lock', files.hook.includes("matchMedia?.('(max-width: 639px)'") && files.hook.includes('previousScrollY'));
check('Modal background gets inert/aria-hidden treatment', files.hook.includes('setElementInert') && files.hook.includes("setAttribute('aria-hidden', 'true')"));
check('Modal scroll cues track real overflow', files.hook.includes('data-scroll-overflow') && files.css.includes('.gd-modal-body[data-scroll-overflow]'));
check('Overlay root exists', files.index.includes('id="gadwal-overlay-root"'));
check('Screenshot tips uses shared modal hook', files.stepAdd.includes('screenshotTipsModalRef') && files.stepAdd.includes('restoreFocusRef: screenshotTipsTriggerRef'));
check('Manual tips uses shared modal hook', files.stepAdd.includes('manualTipsModalRef') && files.stepAdd.includes('restoreFocusRef: manualTipsTriggerRef'));
check('Preferences tips uses shared modal hook', files.stepAdd.includes('preferencesTipsModalRef') && files.stepAdd.includes('restoreFocusRef: preferencesTipsTriggerRef'));
check('Tips triggers preserve their opener', files.stepAdd.includes('screenshotTipsTriggerRef.current = event.currentTarget') && files.stepAdd.includes('manualTipsTriggerRef.current = event.currentTarget') && files.stepAdd.includes('preferencesTipsTriggerRef.current = event.currentTarget'));
check('Modal-to-modal Screenshot Guide handoff passes opener', files.stepAdd.includes('onOpenDemo?.(screenshotTipsTriggerRef.current)'));
check('Tips/review state closes when catalog is cleared', files.stepAdd.includes('if (sections.length === 0)') && files.stepAdd.includes('setIsScreenshotTipsOpen(false)') && files.stepAdd.includes('setIsReviewModalOpen(false)'));
check('Review errors are announced', files.stepAdd.includes('role="alert" aria-live="assertive"'));
check('Demo description uses actual copy', files.demo.includes('{COPY.demo.howTitle}'));
check('Demo arrow navigation is scoped to tablist', files.demo.includes('handleTimelineKeyDown') && files.demo.includes("target.closest('[role=\"tab\"]')") && !files.demo.includes('window.addEventListener(\'keydown\', handleKeyDown)'));
check('Demo tab selection does not forcibly focus panel', !files.demo.includes('panel.focus({ preventScroll: true })'));
check('Context-specific modal close labels exist', files.demo.includes('Close screenshot guide') && files.app.includes('openInfoModal'));
check('Header uses navigation semantics, not menu semantics', files.header.includes('id="mobile-navigation-menu"') && files.header.includes('<nav') && !files.header.includes('role="menu"') && !files.header.includes('role="menuitem"'));
check('Header trigger controls mobile navigation', files.header.includes('aria-controls="mobile-navigation-menu"'));
check('Header uses shared popup interactions', files.header.includes('usePopupInteractions'));
check('Export menu uses shared popup interactions', files.exportMenu.includes('usePopupInteractions'));
check('Export menu has trigger/menu relationship', files.exportMenu.includes('aria-haspopup="menu"') && files.exportMenu.includes('aria-controls={`schedule-export-menu-${rank}`}'));
check('Export menu has viewport-aware above/below placement', files.exportMenu.includes('menuPlacement') && files.exportMenu.includes('getBoundingClientRect') && files.exportMenu.includes('bottom-full'));
check('Export menu exposes error as alert', files.exportMenu.includes('role="alert" aria-live="assertive"'));
check('Higher-priority modal closes lower-priority menus', files.registry.includes('existing.priority < entry.priority') && files.registry.includes('existing.kind === \'menu\''));
check('One menu closes another menu', files.registry.includes('entry.kind === \'menu\' || entry.kind === \'dropdown\''));
check('Info modals opt out of shared transient history', files.demo.includes('manageHistory: false') && files.app.includes('INFO_MODAL_HASHES'));
check('Reduced-motion modal override exists', files.css.includes('.gd-modal-backdrop, .gd-modal-shell') && files.css.includes('prefers-reduced-motion'));
check('Mobile modal safe-area footer remains explicit', files.css.includes('safe-area-inset-bottom'));

console.log(`MODALS / OVERLAYS AUDIT CONTRACT: ${pass}/${total} passed`);
process.exitCode = pass===total ? 0 : 1;
