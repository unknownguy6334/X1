import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const demoModalSrc = read('src/components/DemoModal.tsx');
const copySrc = read('src/content/copy.ts');

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

console.log('=== RUNNING GADWAL SCREENSHOT GUIDE MODAL VERIFICATION (7-STEP WALKTHROUGH) ===\n');

// 1. Check copy exists in copy.ts
assert(copySrc.includes("title: 'Screenshot guide'"), 'Screenshot guide title is exact in copy.ts.');
assert(copySrc.includes('demo: {'), 'Demo copy object exists in copy.ts.');
assert(copySrc.includes("chapter1Label: 'PART 1 · GET READY'"), 'Part 1 label exists in copy.ts.');
assert(copySrc.includes("chapter2Label: 'PART 2 · CAPTURE'"), 'Part 2 label exists in copy.ts.');
assert(copySrc.includes("chapter3Label: 'PART 3 · FINISH'"), 'Part 3 label exists in copy.ts.');
assert(copySrc.includes("step4Body: 'Click each available option one at a time and take a screenshot. For example, Nutrition has just one option, NUT10102-MCM, so take one screenshot, click Back, and move on to your next course.'"), 'Step 4 rewritten copy is exact in copy.ts.');

// 2. Check authentic demo SVG files rendered in DemoModal
const expectedAssets = [
  'public/demo/step1-advising-icon.svg',
  'public/demo/step2-registered-courses.svg',
  'public/demo/step4-course-options.svg',
  'public/demo/step5-single-option-nutrition.svg',
  'public/demo/step6-fin-new07.svg',
  'public/demo/step6-fin-new09.svg',
];

for (const assetRel of expectedAssets) {
  const assetPath = path.join(root, assetRel);
  assert(fs.existsSync(assetPath), `Asset file exists: ${assetRel}`);
  assert(demoModalSrc.includes(path.basename(assetRel)), `Asset ${path.basename(assetRel)} is rendered in DemoModal.`);
}

// 3. 7-Step Walkthrough Architecture
assert(demoModalSrc.includes('currentStep === 1') && demoModalSrc.includes('currentStep === 7'), 'DemoModal renders steps across a 7-step flow.');
assert(demoModalSrc.includes('currentStep < 7'), 'DemoModal supports advancing through 7 steps.');
assert(demoModalSrc.includes('goToPrev') && demoModalSrc.includes('goToNext'), 'DemoModal supports step-by-step navigation.');
assert(demoModalSrc.includes('demo-modal-prev') && demoModalSrc.includes('demo-modal-next'), 'DemoModal provides stable hooks for Previous and Next navigation.');

// 4. Step 3 Specification without the removed Example flow
assert(demoModalSrc.includes('COPY.demo.step3Body1') && demoModalSrc.includes('COPY.demo.step3Body2'), 'Step 3 instructions are sourced from canonical copy.');
assert(!demoModalSrc.includes('See Examples'), 'Removed Example CTA from the screenshot guide.');
assert(!demoModalSrc.includes('showCourseRulePopup') && !demoModalSrc.includes('course-rule-dialog'), 'Removed Example-specific popup state and dialog from the screenshot guide.');
assert(!demoModalSrc.includes('Course → Available section options'), 'Removed redundant structure text from Step 3.');

// 5. Part 1, Part 2 (4 steps), Part 3 Organization
assert(demoModalSrc.includes('COPY.demo.chapter1Label'), 'Part 1 label is sourced from canonical copy.');
assert(demoModalSrc.includes('COPY.demo.chapter2Label'), 'Part 2 label is sourced from canonical copy.');
assert(demoModalSrc.includes('COPY.demo.chapter3Label'), 'Part 3 label is sourced from canonical copy.');
assert(demoModalSrc.includes('CHAPTER_GROUPS'), 'DemoModal maps steps into 3 distinct part groups.');
assert(demoModalSrc.includes('stepIds: [3, 4, 5, 6]'), 'Part 2 (Capture) contains 4 steps (3, 4, 5, 6).');

// 6. Step 4 Rewritten Text & Annotated Visual
assert(demoModalSrc.includes('COPY.demo.step4Body'), 'Step 4 instruction is sourced from canonical copy.');
const step4Svg = read('public/demo/step5-single-option-nutrition.svg');
assert(step4Svg.includes('(Course Name)'), 'Step 4 SVG has arrow and callout for (Course Name).');
assert(step4Svg.includes('(Course Code)'), 'Step 4 SVG has arrow and callout for (Course Code).');
assert(step4Svg.includes('(Days)'), 'Step 4 SVG has arrow and callout for (Days).');
assert(step4Svg.includes('(Timing)'), 'Step 4 SVG has arrow and callout for (Timing).');

// 7. Step 6: Formatted Summary Step
assert(demoModalSrc.includes('currentStep === 6'), 'Step 6 is present.');
assert(demoModalSrc.includes('6. Summary'), 'Step 6 is titled 6. Summary.');
assert(demoModalSrc.includes('1. Open Advising'), 'Step 6 includes 1. Open Advising.');
assert(demoModalSrc.includes('2. Clear your schedule'), 'Step 6 includes 2. Clear your schedule.');
assert(demoModalSrc.includes('3. Choose your courses'), 'Step 6 includes 3. Choose your courses.');
assert(demoModalSrc.includes('4. Open each course'), 'Step 6 includes 4. Open each course.');
assert(demoModalSrc.includes('5. Screenshot each option'), 'Step 6 includes 5. Screenshot each option.');
assert(demoModalSrc.includes('6. Repeat for every course'), 'Step 6 includes 6. Repeat for every course.');
assert(demoModalSrc.includes('7. Upload your screenshots'), 'Step 6 includes 7. Upload your screenshots.');
assert(demoModalSrc.includes('Simple rule: Choose the courses you want, screenshot every option, then upload them.'), 'Step 6 includes exact simple rule text.');
assert(!demoModalSrc.includes('Once all your screenshots are ready, continue to Part 3 to upload them to GADWAL.'), 'Removed old transition text from Step 6.');

// 8. Step 7: Finish Step Cleared of Redundant Box
assert(demoModalSrc.includes('currentStep === 7'), 'Step 7 is present.');
assert(!demoModalSrc.includes('Ready with your screenshots?'), 'Removed square text block "Ready with your screenshots?" from finish step.');
assert(demoModalSrc.includes('id="demo-modal-btn-action"'), 'Step 7 / footer includes primary upload action button.');

// 9. Visual Interactive Progress Timeline
assert(demoModalSrc.includes('role="tablist"') || demoModalSrc.includes('aria-label="Demo steps timeline"'), 'DemoModal includes visual progress timeline.');
assert(demoModalSrc.includes('setCurrentStep(stepId)'), 'Timeline allows direct step jump navigation on click.');
assert(demoModalSrc.includes('isCompleted') && demoModalSrc.includes('isCurrent'), 'Timeline visually distinguishes current, completed, and future steps.');

// 10. Clean Uncluttered Step Layout (Removed repetitive STEP X OF 7 and PART headers)
assert(!demoModalSrc.includes('STEP 1 OF 7'), 'STEP 1 OF 7 removed from step body to save space.');
assert(!demoModalSrc.includes('STEP 7 OF 7'), 'STEP 7 OF 7 removed from step body to save space.');
assert(!demoModalSrc.includes('Flashcard'), 'Does not use extraneous flashcard counting.');

// 11. Modal Header Structure
assert(demoModalSrc.includes('id="demo-modal-title"'), 'DemoModal declares id="demo-modal-title".');
assert(demoModalSrc.includes('id="demo-modal-close"'), 'DemoModal declares close button hook.');
assert(demoModalSrc.includes('role="dialog"') && demoModalSrc.includes('aria-modal="true"'), 'DemoModal declares accessible dialog attributes.');
assert(demoModalSrc.includes('useModalAccessibility'), 'DemoModal uses useModalAccessibility hook.');

// 12. Clean header without extraneous buttons
assert(!demoModalSrc.includes('demo-btn-quick-tips'), 'Quick tips button removed from header.');
assert(!demoModalSrc.includes('demo-btn-full-example'), 'Full example button removed from header.');

// 13. Navigation Behavior
assert(demoModalSrc.includes('disabled={currentStep === 1}'), 'Previous button is disabled on Step 1.');
assert(demoModalSrc.includes('ArrowLeft') && demoModalSrc.includes('ArrowRight'), 'DemoModal supports left and right arrow keyboard navigation.');

// 14. Voice tone & forbidden patterns
assert(!demoModalSrc.includes('—'), 'No em dash in DemoModal.tsx.');
assert(!demoModalSrc.includes('Get started'), 'No generic "Get started" in DemoModal.tsx.');
assert(!demoModalSrc.includes('Proceed'), 'No generic "Proceed" in DemoModal.tsx.');
assert(!demoModalSrc.includes('Submit'), 'No generic "Submit" in DemoModal.tsx.');

// 15. Integration in Header, StepAddCourses, and App
const headerSrc = read('src/components/Header.tsx');
const appSrc = read('src/App.tsx');
const stepAddSrc = read('src/components/StepAddCourses.tsx');

assert(headerSrc.includes('id="header-btn-demo"'), 'Header has desktop Demo/Guide button hook.');
assert(headerSrc.includes('id="mobile-menu-demo"'), 'Header has mobile menu Demo/Guide button hook.');
assert(appSrc.includes('DemoModal'), 'App.tsx imports and renders DemoModal.');
assert(stepAddSrc.includes('id="upload-demo-link"'), 'StepAddCourses has upload demo link hook.');
assert(stepAddSrc.includes('id="start-demo-link"'), 'StepAddCourses has start panel demo link hook.');

console.log(`\nINTERACTIVE GUIDE MODAL AUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED.\n`);
