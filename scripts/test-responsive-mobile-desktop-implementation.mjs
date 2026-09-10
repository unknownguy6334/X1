import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/components/Header.tsx'), 'utf8');
const add = fs.readFileSync(path.join(root, 'src/components/StepAddCourses.tsx'), 'utf8');
const demo = fs.readFileSync(path.join(root, 'src/components/DemoModal.tsx'), 'utf8');
const how = fs.readFileSync(path.join(root, 'src/components/HowItWorksModal.tsx'), 'utf8');
const results = fs.readFileSync(path.join(root, 'src/components/StepResults.tsx'), 'utf8');
const posts = fs.readFileSync(path.join(root, 'src/components/StudentGapPosts.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['header uses product breakpoint classes', header.includes('responsive-header-desktop') && header.includes('responsive-header-mobile') && css.includes('@media (min-width: 901px)')],
  ['700px width jump removed', css.includes('max-width: min(680px, calc(100vw - 32px))') && !css.includes('max-width: 480px; padding-inline: 16px')],
  ['long course names wrap', css.includes('.responsive-course-main strong { min-width: 0; overflow-wrap: anywhere; white-space: normal; }')],
  ['mobile form controls stay 16px', css.includes('.responsive-product-shell input,') && css.includes('font-size: 16px !important;')],
  ['OCR review controls meet 44px floor', css.includes('.ocr-review-modal input, .ocr-review-modal select, .ocr-review-modal button:not(.gd-modal-close) { min-height: 44px; }')],
  ['upload/dynamic messages wrap safely', css.includes('.responsive-upload-message > *') && css.includes('overflow-wrap: anywhere')],
  ['preference actions wrap on narrow screens', add.includes('responsive-preference-actions') && css.includes('@media (max-width: 500px)')],
  ['visual viewport keyboard handling exists', add.includes('visualViewport') && add.includes('isKeyboardViewportOpen') && css.includes('is-keyboard-open')],
  ['manual input avoids mobile autofocus', add.includes("matchMedia('(min-width: 768px)')")],
  ['guide has explicit mobile scroll cue', demo.includes('Swipe horizontally to see all steps') && css.includes('.gd-modal-guide-scroll-cue')],
  ['breakpoint vocabulary documented', css.includes('--g-breakpoint-compact') && css.includes('--g-breakpoint-comfortable') && css.includes('--g-breakpoint-desktop')],
  ['guide grids are content-width aware', demo.includes('gd-demo-auto-grid') && css.includes('.gd-demo-auto-grid')],
  ['how-it-works example labels wrap', how.includes('whitespace-normal break-words')],
  ['large upload batches collapse', add.includes('responsive-file-details') && add.includes('uploadedFiles.length > 8')],
  ['secondary upload actions are de-emphasized', add.includes('responsive-upload-secondary-actions')],
  ['secondary result metadata moves to details on mobile', results.includes('responsive-schedule-secondary') && css.includes('.responsive-schedule-secondary { display: none; }')],
  ['result filter stacks narrowly', css.includes('.responsive-filter-strip { grid-template-columns: 1fr;')],
  ['student post is aspect based', posts.includes('aspect-[16/10]') && posts.includes('max-h-[310px]')],
  ['header has one mobile height', css.includes('height: 56px !important;')],
  ['page shell owns vertical rhythm', css.includes('.responsive-product-shell { padding-top: 0; }')],
  ['modal has viewport fallback', css.includes('height: 100svh;') && css.includes('height: 100dvh;')],
  ['optimizer toast follows visual viewport', app.includes('responsive-optimizer-toast') && css.includes('--g-visual-bottom-inset')],
  ['viewport matrix script is registered', pkg.scripts['qa:responsive:matrix'] === 'node scripts/verify-responsive-viewport-matrix.mjs'],
  ['viewport matrix covers requested widths', fs.readFileSync(path.join(root, 'scripts/verify-responsive-viewport-matrix.mjs'), 'utf8').includes('[320, 360, 390, 414, 768, 1024, 1280, 1440]')],
  ['compact breakpoints retain narrow interaction rules', css.includes('@media (max-width: 380px)') && css.includes('.responsive-time-pair')],
];

const failures = checks.filter(([, ok]) => !ok);
console.log(`Responsive implementation checks: ${checks.length - failures.length}/${checks.length}`);
for (const [name] of failures) console.error(`FAIL: ${name}`);
if (failures.length) process.exit(1);
