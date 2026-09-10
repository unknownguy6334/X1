import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const app = read('src/App.tsx');
const header = read('src/components/Header.tsx');
const hook = read('src/hooks/useModalAccessibility.ts');
const demo = read('src/components/DemoModal.tsx');
const how = read('src/components/HowItWorksModal.tsx');
const promise = read('src/components/PromiseModal.tsx');
const copy = read('src/content/copy.ts');
const css = read('src/index.css');
const navigation = read('src/app/navigation.ts');

const checks = [
  ['Informational guide hash exists', navigation.includes("demo: '#guide'")],
  ['How It Works hash exists', navigation.includes("'how-it-works': '#how-it-works'")],
  ['Promise hash exists', navigation.includes("promise: '#promise'")],
  ['App stores underlying workflow state for informational history', app.includes('gadwalUnderlyingStep')],
  ['Close-and-navigate replaces modal history entry', app.includes("window.history.replaceState({ step }, '', getStepHash(step))")],
  ['Modal accessibility hook does not own history pushState', !hook.includes('pushState') && !hook.includes('history.back')],
  ['Modal accessibility supports explicit focus restoration ref', hook.includes('restoreFocusRef')],
  ['Mobile informational triggers pass the actual menu toggle ref', header.includes('onOpenHowItWorks(toggleButtonRef.current)') && header.includes('onOpenPromise(toggleButtonRef.current)') && header.includes('onOpenDemo?.(toggleButtonRef.current)')],
  ['Desktop informational destinations are real links', header.includes('href="#guide"') && header.includes('href="#how-it-works"') && header.includes('href="#promise"')],
  ['Guide tab buttons have controls and matching tabpanel', demo.includes('aria-controls={`demo-step-panel-${stepId}`}') && demo.includes('role="tabpanel"') && demo.includes('aria-labelledby={`demo-step-tab-${currentStep}`}')],
  ['Guide step changes announce current step', demo.includes('aria-live="polite"')],
  ['Guide timeline can scroll on narrow screens', css.includes('gd-modal-guide-timeline') && css.includes('overflow-x: auto')],
  ['How It Works uses canonical copy', how.includes('COPY.how.sections') && how.includes('COPY.how.searches') && how.includes('COPY.how.startAction')],
  ['Screenshot guide uses canonical step copy', demo.includes('COPY.demo.step4Body') && demo.includes('COPY.demo.step7Ending')],
  ['Promise content has a canonical content object', copy.includes('promise: {')],
  ['Promise renders canonical content', promise.includes('COPY.promise.core') && promise.includes('COPY.promise.finalTrust') && promise.includes('COPY.promise.startAction')],
  ['Search guide promise matches bounded search behavior', copy.includes('within its search limits')],
  ['How It Works explains user preferences affect search', how.includes('GADWAL also applies the preferences you set')],
  ['Unsupported authenticity claim removed from screenshot guide alt text', !demo.includes('alt="Real Advising portal icon"') && demo.includes('Illustration of the student portal Advising entry point')],
  ['Informational deep-link hash is excluded from workflow unknown-route replacement', app.includes('const infoModal = getInfoModalFromHash(hash);') || app.includes('const infoModal = getCanonicalInfoModalFromHash(hash);')],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (ok) passed++; }
console.log(`GUIDE/HOW/PROMISE IMPLEMENTATION: ${passed}/${checks.length} passed`);
process.exitCode = passed === checks.length ? 0 : 1;
