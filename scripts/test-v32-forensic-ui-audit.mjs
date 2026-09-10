import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = [];
const pass = [];
const must = (condition, label) => condition ? pass.push(label) : fail.push(label);
const mustNot = (condition, label) => condition ? fail.push(label) : pass.push(label);

const header = read('src/components/Header.tsx');
const hero = read('src/components/HeroBanner.tsx');
const posts = read('src/components/StudentGapPosts.tsx');
const add = read('src/components/StepAddCourses.tsx');
const css = read('src/index.css');
const app = read('src/App.tsx');

// S03: homepage hero and header polish.
must(hero.includes('Stop wasting hours between courses.') || read('src/content/copy.ts').includes('Stop wasting hours between courses.'), 'Hero headline remains unchanged.');
must(hero.includes('mt-4 sm:mt-6') && hero.includes('space-y-2 sm:space-y-3'), 'Hero vertical rhythm is tightened without removing content.');
must(hero.includes('focus-visible:outline-none') && hero.includes('focus-visible:ring-2'), 'Learn how has an explicit visible keyboard focus treatment.');
must(hero.includes('min-h-[44px]') && hero.includes('text-brand-green'), 'Learn how remains secondary but has a comfortable target and brand color.');
mustNot(header.includes('backdrop-blur'), 'Header no longer uses backdrop blur/glass-like treatment.');

// S02: real student carousel controls and continuity.
must(posts.includes('min-h-[44px] px-3 rounded-lg'), 'Previous carousel control is at least 44px tall.');
must(posts.includes('min-h-[44px] px-3.5 rounded-lg'), 'Next carousel control is at least 44px tall.');
must(posts.includes('mt-2.5 flex items-center justify-between'), 'Carousel control band spacing is tightened.');
must(posts.includes('onTouchStart') && posts.includes('onTouchEnd'), 'Mobile carousel gesture handlers remain present.');
must(posts.includes('onFocusCapture') && posts.includes('onBlurCapture'), 'Carousel focus pause behavior remains present.');

// S01: Add Courses visual hierarchy and naming.
must(css.includes('.responsive-big-choice {'), 'Shared Add Courses choice component still has a baseline system definition.');
must(css.includes('border-left: 2px solid var(--border);'), 'Choice rows use a lighter structural accent instead of heavy framing.');
must(css.includes('box-shadow: none;'), 'Choice rows no longer rely on elevation for hierarchy.');
must(css.includes('.responsive-big-choice:hover { border-color: var(--color-line-strong); background: var(--surface-secondary); }'), 'Choice-row hover state uses restrained semantic feedback.');
must(add.includes('See screenshot guide'), 'Screenshot guide action remains available.');
must(add.includes('See how it works'), 'How-it-works link wording matches its destination.');
must(add.includes('responsive-help-link-secondary'), 'Secondary support action has distinct visual hierarchy.');
must(css.includes('.responsive-help-link:focus-visible'), 'Support links have visible focus treatment.');
must(add.includes('FAST'), 'FAST semantic badge remains present for the screenshot route.');
mustNot(add.match(/FAST[\s\S]{0,250}shadow-xs/) !== null, 'FAST badge is not given a decorative shadow.');

// S02/S03: intentional proof-to-task pacing without extra cards.
must(css.includes('.responsive-product-shell { display: block; padding-top: .5rem; }'), 'Product workflow receives baseline separation from surrounding sections.');
must(css.includes('.responsive-product-shell { padding-top: 1.35rem; }'), 'Mobile proof-to-task handoff receives additional spacing.');
mustNot(css.includes('student-gap-posts .'), 'No new decorative carousel system was introduced.');

// Motion/accessibility guardrails.
must(css.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion media query remains present.');
must(css.includes('transition: color .15s ease, background-color .15s ease;'), 'Support-link motion is restrained.');

// Source integrity checks for visible content.
mustNot(hero.includes('bg-gradient-') || hero.includes('backdrop-blur'), 'Hero keeps prohibited gradient/blur decoration out.');
mustNot(app.includes('ScheduleComparisonModal'), 'Removed example/comparison modal architecture stays absent.');

console.log(`FORENSIC UI AUDIT CHECKS: ${pass.length} passed, ${fail.length} failed`);
for (const item of pass) console.log(`PASS: ${item}`);
for (const item of fail) console.error(`FAIL: ${item}`);
if (fail.length) process.exit(1);
