import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(tsx|ts|css)$/.test(entry.name)) files.push(p);
  }
}
walk(root);
const source = Object.fromEntries(files.map((f) => [path.relative(process.cwd(), f), fs.readFileSync(f, 'utf8')]));
let passed = 0, failed = 0;
function assert(ok, message) {
  if (ok) { console.log(`PASS ${message}`); passed++; }
  else { console.error(`FAIL ${message}`); failed++; }
}

const all = Object.values(source).join('\n');
assert(!all.includes('backdrop-blur'), 'No backdrop blur remains anywhere in UI source.');
assert(!all.includes('linear-gradient'), 'No CSS gradients remain in UI source.');
assert(!source['src/components/StepResults.tsx']?.includes('Sparkles'), 'Results notices do not use AI-style Sparkles icon.');

for (const [file, text] of Object.entries(source)) {
  if (file.endsWith('.tsx') && text.includes('role="dialog"')) {
    assert(text.includes('aria-modal="true"'), `${file}: dialogs declare aria-modal.`);
    assert(text.includes('gd-modal-shell'), `${file}: dialog uses the shared modal shell.`);
  }
}

for (const file of [
  'src/components/HowItWorksModal.tsx',
  'src/components/PromiseModal.tsx',
  'src/components/PrivacyModal.tsx',
  'src/components/DemoModal.tsx',
  'src/components/StepAddCourses.tsx',
]) {
  const text = source[file] || '';
  assert(text.includes('gd-modal-sheet'), `${file}: long modal uses mobile sheet pattern.`);
}

for (const [file, text] of Object.entries(source)) {
  if (file.endsWith('.tsx') && (text.includes('button') || text.includes('<a '))) {
    const has44 = text.includes('min-h-[44px]') || text.includes('gd-modal-close');
    assert(has44, `${file}: common interactive UI retains an explicit 44px target or shared modal close target.`);
  }
  if (file.includes('components/') && file.endsWith('.tsx')) {
    assert(!text.includes('—'), `${file}: no em dash in UI-facing source.`);
  }
}
const css = source['src/index.css'] || '';
assert(css.includes('.gd-modal-footer button { min-height: 44px; }'), 'Shared modal footer enforces 44px controls.');
assert(css.includes('.responsive-product-shell button,') && css.includes('min-height: 44px;'), 'Shared workflow controls retain a 44px target floor.');

const copy = source['src/content/copy.ts'] || '';
assert(copy.includes("primary: 'Find my best schedule'"), 'Primary CTA copy remains canonical.');
assert(copy.includes("guide: 'Learn how'"), 'Secondary hero action remains canonical.');
assert(copy.includes("title: 'Our Promise'" ) || (source['src/components/PromiseModal.tsx'] || '').includes('Our Promise'), 'Promise modal keeps its canonical title.');

console.log(`\nGlobal UI audit: ${passed} passed, ${failed} failed.`);
process.exitCode = failed ? 1 : 0;
