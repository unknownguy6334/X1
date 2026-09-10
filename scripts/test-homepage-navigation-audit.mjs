import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = [];
const assert = (condition, message) => {
  if (!condition) fail.push(message);
  else console.log(`✓ [PASS] ${message}`);
};

const app = read('src/App.tsx');
const header = read('src/components/Header.tsx');
const hero = read('src/components/HeroBanner.tsx');
const demo = read('src/components/DemoModal.tsx');
const carousel = read('src/components/StudentGapPosts.tsx');
const css = read('src/index.css');
const copy = read('src/content/copy.ts');
const html = read('index.html');

console.log('=== GADWAL HOMEPAGE / NAVIGATION IMPLEMENTATION VERIFICATION ===\n');

// Hero render connection
assert(hero.includes('{COPY.hero.question}'), 'Hero renders the canonical question copy.');
assert(hero.includes('{COPY.hero.problem}'), 'Hero renders the canonical problem copy.');
assert(hero.includes('{COPY.hero.empathy}'), 'Hero renders the canonical empathy copy.');
assert(hero.includes('{COPY.hero.why}'), 'Hero renders the canonical solution copy.');
assert(hero.includes('<GapProblemVisual />'), 'Hero uses the gap visualization as the primary visual.');
assert(hero.includes('aria-label="How it works"'), 'Hero exposes the canonical How it works accessible name.');

// Example flow fully removed from the Guide implementation
assert(!demo.includes('See Examples'), 'Example CTA is absent from the screenshot guide.');
assert(!demo.includes('showCourseRulePopup'), 'Example popup state is absent from the screenshot guide.');
assert(!demo.includes('course-rule-dialog'), 'Example popup dialog markup is absent from the screenshot guide.');
assert(!fs.existsSync(path.join(root, 'public/screenshot-example.svg')), 'Unused Example screenshot asset is removed.');

// Navigation contract
assert(header.includes('Screenshot guide'), 'Header has an explicit Screenshot guide destination.');
assert(header.includes('How it works'), 'Header has an explicit How it works destination.');
assert(header.includes('Our promise'), 'Header has an explicit Our promise destination.');
assert(!header.includes('onOpenGuide'), 'Header no longer exposes ambiguous unused onOpenGuide API.');
assert(app.includes("onOpenHowItWorks={(trigger) => openInfoModal('how-it-works', trigger)}"), 'App wires How it works to its modal destination.');
assert(app.includes("onOpenDemo={(trigger) => openInfoModal('demo', trigger)}"), 'App wires Screenshot guide to its modal destination.');
assert(app.includes("onOpenPromise={(trigger) => openInfoModal('promise', trigger)}"), 'App wires Our promise to its modal destination.');

// Hash / history synchronization and scroll restoration
assert(app.includes("window.addEventListener('hashchange', handleHistoryNavigation)"), 'Direct hash changes are synchronized.');
assert(app.includes("window.addEventListener('popstate', handleHistoryNavigation)"), 'Browser Back/Forward are synchronized.');
assert(app.includes("window.scrollTo({ top: 0, left: 0, behavior: 'auto' })"), 'Navigation restores a predictable top scroll position.');
assert(app.includes("window.history.pushState({ step, gadwalWorkflowGenerationId:"), 'Step navigation pushes supported hash state.');
assert(app.includes("window.history.replaceState({ step, gadwalWorkflowGenerationId:"), 'Step navigation can replace supported hash state.');

// Consistent Home access across non-home steps
assert(header.includes('id="header-btn-home"'), 'Header exposes an explicit Home navigation control.');
assert(header.includes("aria-current={currentStep === 'home' ? 'page' : undefined}"), 'Header exposes the current home location programmatically.');
assert(header.includes('href="/#home"'), 'Brand mark is a real home link.');

// Mobile footer remains available
assert(!css.includes('.site-footer { display: none !important; }'), 'Mobile CSS no longer hides the footer.');
assert(css.includes('.site-footer > div > div:last-child'), 'Mobile footer gets a deliberate compact layout.');
assert(app.includes('See the screenshot guide'), 'Homepage footer keeps screenshot guide CTA.');
assert(app.includes('See how it works'), 'Homepage footer keeps how-it-works CTA.');
assert(app.includes('Read our promise'), 'Homepage footer keeps promise CTA.');

// Font determinism
assert(!html.includes('fonts.googleapis.com'), 'Homepage no longer depends on Google Fonts at runtime.');
assert(css.includes('--font-sans: Inter,'), 'Primary font stack uses bundled Inter.');
assert(read('src/main.tsx').includes("@fontsource/inter/latin.css"), 'Inter is locally bundled.');

// Carousel performance and behavior
assert(!carousel.includes('requestAnimationFrame(updateProgress)'), 'Carousel progress does not update React on every animation frame.');
assert(carousel.includes('window.setInterval(updateProgress, 500)'), 'Carousel accessibility progress uses a bounded 500ms update interval.');
assert(carousel.includes("const nextIndex = (currentIndex + direction + POSTS.length) % POSTS.length;"), 'Carousel navigation is cyclic in both directions.');
assert(carousel.includes("animationPlayState: isPaused ? 'paused' : 'running'"), 'Visual progress pauses and resumes without React frame churn.');
assert(carousel.includes('Student posts about schedule gaps'), 'Carousel uses provenance-safe user-facing wording.');
assert(!carousel.includes('Real student post'), 'Carousel no longer makes an unverified real-user provenance claim.');

// Messaging consistency
assert(copy.includes("title: 'Screenshot guide'"), 'Guide modal uses its canonical destination name.');
assert(!header.includes('No More Gaps'), 'Header no longer presents a literal zero-gap guarantee.');

if (fail.length) {
  console.error(`\nFAILED: ${fail.length} verification checks.`);
  for (const item of fail) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`\nALL HOMEPAGE / NAVIGATION IMPLEMENTATION CHECKS PASSED.`);
