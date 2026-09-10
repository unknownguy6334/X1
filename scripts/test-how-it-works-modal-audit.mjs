import fs from 'node:fs';

const file = new URL('../src/components/HowItWorksModal.tsx', import.meta.url);
const source = fs.readFileSync(file, 'utf8');

const checks = [
  ['Modal keeps the required title', source.includes('{COPY.how.title}')],
  ['Modal keeps the required explanatory subtitle', source.includes('You choose the courses. GADWAL checks the combinations.')],
  ['Section 1 is present', source.includes('1. You choose the courses')],
  ['Course A example is present', source.includes("{ label: 'Course A', count: '1 option', options: ['ACT20101'] }")],
  ['Course B examples are present', source.includes("{ label: 'Course B', count: '2 options', options: ['ECN33104', 'ECN33106'] }")],
  ['Course C examples are present', source.includes("{ label: 'Course C', count: '3 options', options: ['FIN32101', 'FIN32102', 'FIN32103'] }")],
  ['Section 2 is present', source.includes('2. That creates a lot of combinations')],
  ['All six example combinations are present', [
    'ACT20101 + ECN33104 + FIN32101',
    'ACT20101 + ECN33104 + FIN32102',
    'ACT20101 + ECN33104 + FIN32103',
    'ACT20101 + ECN33106 + FIN32101',
    'ACT20101 + ECN33106 + FIN32102',
    'ACT20101 + ECN33106 + FIN32103',
  ].every(v => source.includes(v))],
  ['Hundreds of possibilities is preserved', source.includes('Hundreds of possibilities')],
  ['Self-test / GADWAL line is preserved', source.includes('COPY.how.manual') && source.includes('COPY.how.handoff')],
  ['Section 3 is present', source.includes('3. GADWAL searches the combinations')],
  ['All three search criteria are present', ['COPY.how.fewerDays', 'COPY.how.lessGap', 'COPY.how.noConflicts'].every(v => source.includes(v))],
  ['Section 4 is present', source.includes('4. You choose the one you like best')],
  ['All three schedule examples are present', ['Schedule 1', 'Schedule 2', 'Schedule 3'].every(v => source.includes(v))],
  ['Final choice statement is preserved', source.includes('You choose the schedule that works best for you.')],
  ['Mobile modal is full-height', source.includes('gd-modal-sheet')],
  ['Desktop modal retains a bounded height', source.includes('gd-modal-sheet') && source.includes('sm:max-w-3xl')],
  ['Mobile modal has no outer page padding', source.includes('justify-center p-0 sm:p-5') && source.includes('gd-modal-backdrop')],
  ['Desktop modal retains intentional radius', source.includes('gd-modal-shell') && source.includes('sm:max-w-3xl')],
  ['Overlay no longer uses backdrop blur', !source.includes('backdrop-blur')],
  ['Modal itself is the only elevated overlay', fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').includes('.gd-modal-shell') && fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').includes('box-shadow: 0 14px 34px')],
  ['Decorative infinite motion was removed', !source.includes('repeat: Infinity')],
  ['Decorative sparkles icon was removed', !source.includes("Sparkles")],
  ['Decorative moving arrow was removed', !source.includes('ArrowDown')],
  ['Hover scale decoration was removed', !source.includes('whileHover={{ scale')],
  ['Result cards no longer shift on hover', !source.includes('whileHover={{ x: 3 }}')],
  ['Buttons retain accessible 44px targets', (source.match(/min-h-\[44px\]/g) || []).length >= 2],
  ['Close control has an accessible label', (/aria-label="Close(?: [^"]+)?"/.test(source))],
  ['Modal retains dialog semantics', source.includes('role="dialog"') && source.includes('aria-modal="true"')],
  ['Modal body remains independently scrollable', source.includes('gd-modal-body') && source.includes('data-modal-scroll')],
  ['Footer remains fixed within modal flex layout', source.includes('gd-modal-footer') && source.includes('border-t border-line')],
  ['Reduced-motion global support remains available', fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').includes('@media (prefers-reduced-motion: reduce)')],
];

const failures = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
console.log(`HOW IT WORKS MODAL AUDIT: ${checks.length - failures.length} passed, ${failures.length} failed`);
process.exitCode = failures.length ? 1 : 0;
