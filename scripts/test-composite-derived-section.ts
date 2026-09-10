import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const pass = [];

function must(file, pattern, label) {
  const text = read(file);
  if (pattern.test(text)) pass.push(label);
  else failures.push(`${label} (${file})`);
}
function mustNotGlob(pattern, label) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'src'));
  const found = files.some((file) => pattern.test(fs.readFileSync(file, 'utf8')));
  if (found) failures.push(label);
  else pass.push(label);
}

const css = read('src/index.css');
const cssWithoutMedia = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');

must('src/index.css', /\.responsive-big-choice\s*\{/, 'shared course choice has a baseline CSS definition');
must('src/index.css', /\.responsive-primary-button\s*,\s*\.responsive-secondary-button/, 'shared action buttons have one baseline system');
must('src/index.css', /--g-space-4:|--g-radius-md:|--g-elevation-1:|--g-container-page:/, 'shared spacing radius elevation and container tokens exist');
must('src/App.tsx', /<StepAddCourses/, 'application uses the shared course workflow component');
must('src/components/StepResults.tsx', /const responsiveResults\s*=|const responsiveResults\s*=\s*\(/, 'application uses one shared results workflow tree');
mustNotGlob(/export\s+(?:const|default)\s+<(?:Mobile|Desktop)[A-Z][A-Za-z]+|class\s+(?:Mobile|Desktop)[A-Z][A-Za-z]+|function\s+(?:Mobile|Desktop)[A-Z][A-Za-z]+/, 'no Mobile*/Desktop* product components in source');
mustNotGlob(/isMobileLayout|mobileMode|legacyViewportMode/, 'no viewport-specific workflow state');
mustNotGlob(/className=["'][^"']*\b(?:hidden\s+sm:block|sm:hidden)\b[^"']*["'][^\n]*(?:Course|Schedule)/, 'no viewport-hidden duplicate course/schedule product trees');
must('src/components/StepAddCourses.tsx', /Choose screenshots/, 'explicit screenshot picker control exists');
mustNotGlob(/More Details|More Options|Lock (course|section)|Unlock (course|section)|>\s*Instructor\s*</i, 'removed course-entry features stay removed');
mustNotGlob(/<button[^>]*>\s*(Saved|Compare|Calendar|CRN|Registration Codes)\s*</i, 'removed schedule action buttons stay removed');
must('src/components/ScheduleExportMenu.tsx', /Download as PDF|Download as image|Download as text/, 'More export actions remain available');
must('src/components/StepAddCourses.tsx', /Course added|Courses added/, 'course success state remains');
must('src/components/StepAddCourses.tsx', /Must take/, 'Must take remains available');
mustNotGlob(/GADWALL/, 'GADWAL spelling is consistent in user-facing source');
must('index.html', /favicon-48x48\.png|favicon\.ico|apple-touch-icon\.png/, 'favicon assets are linked');

let depth = 0;
for (const ch of css) {
  if (ch === '{') depth++;
  if (ch === '}') depth--;
}
if (depth === 0) pass.push('CSS braces are balanced'); else failures.push('CSS braces are unbalanced');

if (failures.length) {
  console.error(`FAIL ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PASS ${pass.length}`);
console.log('Source structure and responsive architecture checks passed.');
