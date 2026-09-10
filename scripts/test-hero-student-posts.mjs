import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const heroSrc = read('src/components/HeroBanner.tsx');
const carouselSrc = read('src/components/StudentGapPosts.tsx');
const cssSrc = read('src/index.css');

const postAssets = Array.from({ length: 8 }, (_, i) => `public/student-posts/post-${String(i + 1).padStart(2, '0')}.webp`);
const durations = [4000, 4000, 5000, 8000, 8000, 11000, 15000, 20000];
const exactMarkers = [
  'Gap men 11:30 le7ad 4:30',
  'Bet3melo eh f gap el 4 w el 5 hours',
  'Gm3a ana 3ndy gaps 4 w 5 s3at',
  'Tb ana delw2ty gadwaly 3ndy yom fy 3 s3at w nos gap',
  'كان عندي gap من ١٠ لـ ٤ و نص',
  'جدول الـ freshman نزل',
  'Imagine this:',
  'Guys I really don’t understand',
];

let passed = 0;
let total = 0;
function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`✓ [PASS] ${message}`);
  } else {
    console.error(`✗ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log('=== RUNNING GADWAL REAL STUDENT POST HERO VERIFICATION ===\n');

assert(heroSrc.includes("import { StudentGapPosts } from './StudentGapPosts';"), 'Hero imports the student post carousel.');
assert(heroSrc.includes('<StudentGapPosts />'), 'Hero renders the student post carousel as supporting proof.');
assert(heroSrc.includes('lg:grid-cols-12') && heroSrc.includes('lg:col-span-6'), 'Hero uses a responsive desktop two-column composition.');
assert(heroSrc.includes('mt-8 lg:mt-0'), 'Primary gap visual stays beside the hero copy on desktop while supporting proof follows below.');

for (const duration of durations) {
  assert(carouselSrc.includes(`durationMs: ${duration}`), `Carousel contains required ${duration / 1000}s post timing.`);
}

for (const [index, asset] of postAssets.entries()) {
  assert(fs.existsSync(path.join(root, asset)), `Student post asset exists: ${asset}`);
  assert(carouselSrc.includes(asset.replace('public/', '/')), `Carousel renders post ${index + 1}.`);
}

for (const marker of exactMarkers) {
  assert(carouselSrc.includes(marker), `Carousel identifies the correct source post: ${marker}`);
}

const order = postAssets.map((asset) => carouselSrc.indexOf(asset.replace('public/', '/')));
assert(order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])), 'All eight posts appear in the exact required order.');

for (const required of [
  'aria-label="Student posts about schedule gaps"',
  'Student posts',
  "We've all had days like this.",
  'Next student post',
  'Previous student post',
  'onTouchStart',
  'onTouchEnd',
  'onMouseEnter',
  'onMouseLeave',
  'onFocusCapture',
  'onBlurCapture',
]) {
  assert(carouselSrc.includes(required), `Carousel includes required interaction/accessibility marker: ${required}`);
}

assert(!carouselSrc.includes('disabled={currentIndex === 0}'), 'Previous is cyclic and is not disabled at the first post.');
assert(carouselSrc.includes('{currentIndex + 1} / {POSTS.length}'), 'Progress indicator shows current post out of eight.');
assert(cssSrc.includes('@media (prefers-reduced-motion: reduce)'), 'Reduced-motion media query is present.');
assert(cssSrc.includes('.student-gap-post-progress'), 'Progress animation has a dedicated CSS animation rule.');
assert(!carouselSrc.includes('requestAnimationFrame(updateProgress)'), 'Progress no longer uses a per-frame React state update loop.');
assert(!carouselSrc.includes('animate-spin') && !carouselSrc.includes('animate-bounce'), 'Carousel avoids prohibited spin/bounce animation.');
assert(!heroSrc.includes('bg-gradient-to-') && !heroSrc.includes('blur-3xl'), 'Hero avoids prohibited gradient/blur decoration.');

console.log(`\nREAL STUDENT POST HERO AUDIT COMPLETE: ${passed}/${total} TESTS PASSED.\n`);
if (passed !== total) process.exit(1);
