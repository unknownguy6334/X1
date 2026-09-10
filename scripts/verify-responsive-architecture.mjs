import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const courseBuilderUi = `${read('src/components/StepAddCourses.tsx')}\n${read('src/components/SchedulePreferencesPanel.tsx')}`;
const failures = [];
const pass = [];

function must(file, pattern, label) {
  const text = read(file);
  if (pattern.test(text)) pass.push(label);
  else failures.push(`${label} (${file})`);
}
function mustNot(file, pattern, label) {
  const text = read(file);
  if (pattern.test(text)) failures.push(`${label} (${file})`);
  else pass.push(label);
}

must('src/index.css', /--brand:|--surface:|--text-primary:|--success:|--warning:|--error:|--selected:/, 'semantic color tokens exist');
must('src/index.css', /--g-space-4:|--g-radius-md:|--g-elevation-1:|--g-container-page:/, 'spacing, radius, elevation, and container tokens exist');
must('index.html', /favicon-48x48\.png|favicon\.ico|apple-touch-icon\.png/, 'favicon links exist');
must('src/components/StepAddCourses.tsx', /responsiveCourseBuilder/, 'shared course builder tree exists');
must('src/components/StepResults.tsx', /responsiveResults/, 'shared results tree exists');
mustNot('src/App.tsx', /isMobileLayout|mobileMode|legacyViewportMode/, 'App has no viewport-specific workflow mode');
mustNot('src/components/StepResults.tsx', /legacyViewportMode|responsive-compare-bar|Compare|Calendar|CRN/, 'results has no removed schedule actions');
mustNot('src/components/ScheduleExportMenu.tsx', /Calendar|iCal|CRN|registration codes|Copy codes/, 'export menu has no removed calendar or code actions');
mustNot('src/components/StepAddCourses.tsx', />\s*Instructor\s*</, 'manual and edit UI has no Instructor label');
mustNot('src/components/StepAddCourses.tsx', /More Details|More Options/, 'manual UI has no More Details or More Options');
mustNot('src/components/StepAddCourses.tsx', /Lock (course|section)|Unlock (course|section)/i, 'course UI has no lock controls');
must('src/components/StepAddCourses.tsx', /setWorkflowPanel\('screenshots'\)/, 'Use Screenshots enters the import flow without opening the picker');
must('src/components/StepAddCourses.tsx', /Choose screenshots/, 'native picker requires explicit Choose screenshots action');
must('src/components/StepAddCourses.tsx', /fileInputRef\.current\?\.click\(\)/, 'native picker is opened only by the explicit chooser action');
if (/type="number"[\s\S]*How many credits do you want/.test(courseBuilderUi)) pass.push('credits use direct number input'); else failures.push('credits use direct number input (course builder UI)');
must('src/components/StepAddCourses.tsx', /Course added|Courses added/, 'green centered course-added success state exists');
must('src/components/StepAddCourses.tsx', /responsive-fit-title.*scrollIntoView|scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/s, 'success flow can return to the next step');
must('src/components/StepAddCourses.tsx', /Course.*Credits.*Must take/s, 'course review popup contains required minimal fields');
must('src/content/copy.ts', /Best when you want it fast\./, 'requested screenshot method copy exists');
must('src/content/copy.ts', /Add a course yourself when a screenshot does not have it\./, 'requested manual method copy exists');
mustNot('src/components/Header.tsx', /Privacy/, 'privacy is absent from header UI');
mustNot('src/components/StepAddCourses.tsx', /\bContinue\b/, 'generic Continue CTA is absent from user-facing course workflow');

console.log(`PASS ${pass.length}`);
if (failures.length) {
  console.error(`FAIL ${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('All responsive architecture invariants passed.');
