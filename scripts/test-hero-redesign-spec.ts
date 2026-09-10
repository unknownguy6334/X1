/**
 * Regression Test Suite: GADWAL homepage voice + mobile-first composition.
 * The test guards the non-negotiable homepage hierarchy and copy requirements.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const heroBannerSrc = read('src/components/HeroBanner.tsx');
const copySrc = read('src/content/copy.ts');
const howItWorksSrc = read('src/components/HowItWorksModal.tsx');
const sourceForVoiceAudit = [
  'src/components/HeroBanner.tsx',
  'src/components/Header.tsx',
  'src/components/HowItWorksModal.tsx',
  'src/components/DemoModal.tsx',
  'src/components/PromiseModal.tsx',
  'src/components/PrivacyModal.tsx',
  'src/components/ScheduleExportMenu.tsx',
  'src/components/StepAddCourses.tsx',
  'src/components/StepResults.tsx',
  'src/components/ConfirmResetModal.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/App.tsx',
  'src/content/copy.ts',
].map(read).join('\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [PASS] ${message}`);
  } else {
    console.error(`✗ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log('=== RUNNING GADWAL HOMEPAGE VOICE + MOBILE AUDIT ===\n');

assert(copySrc.includes("title: 'Stop wasting hours between courses.'"), 'Headline is exact.');
assert(copySrc.includes("question: 'Have you ever had a course at 10 AM and your next one was at 1 PM?'"), 'Hero question is exact.');
assert(copySrc.includes("problem: 'That’s 3 hours stuck on campus, waiting around for your next course.'"), 'Hero problem statement is exact.');
assert(copySrc.includes("empathy: 'Nobody wants to spend their day like that.'"), 'Hero empathy statement is exact.');
assert(copySrc.includes("why: 'GADWAL finds you a schedule that actually makes sense.'"), 'Hero solution statement is exact and contains no em dash.');
assert(copySrc.includes("primary: 'Find my best schedule'"), 'Primary CTA is exact.');
assert(copySrc.includes("guide: 'Learn how'"), 'Secondary action is exact.');

assert(heroBannerSrc.includes('id="hero-title"'), 'Hero has a semantic H1 target.');
assert(heroBannerSrc.includes('id="hero-btn-primary"'), 'Primary CTA has a stable hook.');
assert(heroBannerSrc.includes('id="hero-btn-how-it-works"'), 'Secondary Learn How action has a stable hook.');
assert(heroBannerSrc.indexOf('id="hero-title"') < heroBannerSrc.indexOf('id="hero-btn-primary"'), 'Headline appears before the primary CTA.');
assert(!heroBannerSrc.includes('id="how-gadwal-works"'), 'How GADWAL works is not in the front page directly.');

assert(heroBannerSrc.includes('py-10 sm:py-16 lg:py-20') || heroBannerSrc.includes('py-8 sm:py-10 lg:py-12') || heroBannerSrc.includes('py-6 sm:py-8 lg:py-10'), 'Hero uses responsive spacing instead of a fixed desktop-height block.');
assert(heroBannerSrc.includes('min-h-[52px]'), 'Primary CTA exceeds the minimum comfortable touch target.');
assert(heroBannerSrc.includes('flex flex-col gap-3 max-w-md'), 'Hero actions stack cleanly on small screens.');
assert(heroBannerSrc.includes('px-4 sm:px-6'), 'Hero uses mobile-safe horizontal padding.');
assert(heroBannerSrc.includes('max-w-6xl mx-auto') || heroBannerSrc.includes('max-w-3xl mx-auto'), 'Hero content is constrained to readable line lengths.');

assert(!heroBannerSrc.includes('Your Current Week'), 'Old dashboard-like schedule card is removed from the hero.');
assert(!heroBannerSrc.includes('GADWAL Finds A Better Option'), 'Old comparison card is removed from the hero.');
assert(!heroBannerSrc.includes('Schedule gap comparison proof'), 'Old card-heavy proof aria label is removed.');
assert(!heroBannerSrc.includes('Try section 1'), 'Old workflow chip row is removed from the first viewport.');
assert(!heroBannerSrc.includes('7h wasted waiting'), 'Unnecessary decorative metrics are removed from the hero.');
assert(!heroBannerSrc.includes('bg-gradient-to-') && !heroBannerSrc.includes('blur-3xl') && !heroBannerSrc.includes('blob') && !heroBannerSrc.includes('glass-card'), 'No AI-SaaS visual clichés are introduced.');

assert(howItWorksSrc.includes('COPY.how.title'), 'Detailed explanation exists in the popup modal.');
for (const required of [
  'You choose the courses you want.',
  'Each course can have multiple sections with different days and times.',
  'That means there can be hundreds or even thousands of possible combinations.',
  'You could try to test them yourself...',
  'Or let GADWAL do it for you.',
  'fewer days',
  'less gap time',
  'no course conflicts',
  'Then you choose the schedule you like best.',
]) {
  assert(copySrc.includes(required), `How GADWAL works copy includes: ${required}`);
}

assert(!sourceForVoiceAudit.includes('—'), 'No em dash is used in user-facing UI source files.');

const bannedPhrases = [
  'Revolutionize your schedule',
  'Unlock your productivity',
  'Supercharge your week',
  'The future of scheduling',
  'AI-powered scheduling experience',
  'Seamlessly optimize your life',
  'Take control of your destiny',
  'innovative solution',
  'world class scheduling solutions',
  'Optimize your academic journey',
  'Empower students',
  'Next generation scheduling',
];
const foundBanned = bannedPhrases.filter((phrase) => sourceForVoiceAudit.toLowerCase().includes(phrase.toLowerCase()));
assert(foundBanned.length === 0, `Banned marketing phrases are absent: ${foundBanned.join(', ') || 'none'}`);

assert(!sourceForVoiceAudit.includes('Get started'), 'Generic "Get started" CTA wording is absent from user-facing source.');
assert(!sourceForVoiceAudit.includes('Proceed'), 'Generic "Proceed" CTA wording is absent from user-facing source.');
assert(!sourceForVoiceAudit.includes('Submit'), 'Generic "Submit" CTA wording is absent from user-facing source.');

assert(howItWorksSrc.includes('{COPY.how.title}'), 'How-it-works modal reads from the canonical human copy constants.');

console.log(`\nAUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED.`);
if (passedTests !== totalTests) process.exit(1);
