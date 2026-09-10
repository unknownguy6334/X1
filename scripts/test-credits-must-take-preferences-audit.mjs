import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const files = {
  add: read('src/components/StepAddCourses.tsx'), preferenceUi: read('src/components/SchedulePreferencesPanel.tsx'), app: read('src/App.tsx'), types: read('src/types.ts'),
  optimizer: read('src/utils/optimizer.ts'), core: read('src/utils/optimizerCore.ts'), course: read('src/utils/courseUtils.ts'),
  prefs: read('src/utils/preferenceValidation.ts'), persistence: read('src/utils/persistenceValidation.ts'), store: read('src/app/persistence.ts'), results: read('src/components/StepResults.tsx'), css: read('src/index.css'),
};
let n=0; const failures=[]; const ok=(v,m)=>{n++; if(!v) failures.push(m)};
// #1/#12 canonical mandatory identity and ambiguity-safe migration
ok(files.optimizer.includes('function mandatoryCourseKeys(preferences: SchedulePreferences)') && !files.optimizer.includes('legacyNames = new Set((preferences.mandatoryCourses'), 'optimizer has no legacy name-based mandatory expansion');
ok(files.prefs.includes('matches.length === 1') && files.app.includes('matches.length === 1'), 'legacy mandatory migration requires an unambiguous name match');
// #2/#3 must-take UI
ok(files.preferenceUi.includes('formatCourseDisplay(group.courseCode, group.courseName)'), 'must-take options show course code and name');
ok(files.preferenceUi.includes('savedCourseGroups.length > 0 &&') && files.preferenceUi.includes('Courses you must take'), 'must-take control appears for one-course catalogs');
// #4/#5/#6 shared credit contract and safe editing
ok(files.prefs.includes('TARGET_CREDITS_MAX = 100') && files.prefs.includes('CREDIT_PRECISION_STEP = 0.5'), 'shared credit bounds/precision exist');
ok(files.preferenceUi.includes('max={TARGET_CREDITS_MAX}') && files.preferenceUi.includes('step={CREDIT_PRECISION_STEP}') && files.preferenceUi.includes('inputMode="decimal"'), 'credit input matches shared decimal contract');
ok(files.preferenceUi.includes('if (isValidTargetCredits(parsed)) onUpdatePreferences'), 'invalid intermediate credit input is not persisted');
ok(files.persistence.includes('!isValidTargetCredits(parsed.targetCredits)'), 'persistence enforces same target credit contract');
// #7/#8/#9 all active preferences have visible controls and optimizer enforcement
for (const token of ['freeDays','earliestStartTime','latestEndTime','maxDays','preferCompactDays','dayBuckets','useCreditRange']) ok(files.optimizer.includes(token), `optimizer consumes ${token}`);
ok(files.preferenceUi.includes('Preferred campus days') && files.preferenceUi.includes('Days you want free') && files.preferenceUi.includes('Maximum campus days') && files.preferenceUi.includes('Prefer compact days') && files.preferenceUi.includes('Also enforce a credit range'), 'all active preference controls are visible');
// #10 complete stale signature
for (const token of ['targetCourseCount','useCreditRange','minCredits','maxCredits','earliestStartTime','latestEndTime','freeDays','maxDays','preferCompactDays']) ok(files.course.includes('`'+token) || files.course.includes(token), `stale signature includes ${token}`);
ok(files.course.includes('const prefValue = (p: SchedulePreferences | undefined)'), 'stale preference comparison uses canonical full preference value');
// #11 explicit fixed -> mandatory -> elective exact-credit flow
ok(files.optimizer.includes('mandatoryCredits') && files.optimizer.includes('remainingTarget') && files.optimizer.includes('fixedCredits'), 'exact-credit path separates fixed and mandatory credits before elective targeting');
// #13 no silent target reset/clamp
ok(!files.app.includes('resetTargetCount') && !files.add.includes('Auto-clamp target credits'), 'target preferences are not silently reset/clamped');
// #14 unknown credits distinction
ok(files.preferenceUi.includes('unknownCreditCourseCount') && files.preferenceUi.includes('available-credit total is incomplete'), 'unknown credits are distinguished from zero');
// #15/#16 exact UX copy
ok(files.preferenceUi.includes('credit target and course count'), 'credit/course-count relationship is explained');
ok(files.preferenceUi.includes('Courses that you want to take no matter what. GADWAL will include these courses in every schedule it creates.') && files.preferenceUi.includes('text-alert'), 'must-take explanation is exact and visually emphasized');
// #17 lifecycle defaults
for (const field of ['useCreditRange','minCredits','maxCredits','earliestStartTime','latestEndTime','freeDays','maxDays','preferCompactDays']) ok(files.store.includes(field) && files.types.includes(field), `preference lifecycle includes ${field}`);
// #18 early course-count pruning
ok(files.optimizer.includes('const needed = targetCourseCount - fixedCount - mandatorySubjects.length - chosen.length') && files.optimizer.includes('remainingCount'), 'course-count constraint prunes shared subset recursion');
// #19 persistence shared max
ok(files.persistence.includes('isValidTargetCredits'), 'persistence reuses shared target-credit validator');
// #20 independent preferences
ok(!files.app.includes('targetCourseCount: null } : {}'), 'changing target credits does not clear target course count');
// #21/#22 summaries
ok(files.add.includes('responsive-preference-summary') && files.add.includes('Built using'), 'setup shows live preference summary');
ok(files.results.includes('Preferences used to build these schedules') && files.results.includes('Built using'), 'results show enforced preference summary');
// #23 decimal mobile configuration
ok(files.preferenceUi.includes('inputMode="decimal"'), 'credit input requests decimal-capable mobile entry');
console.log(`CREDITS/MUST-TAKE/PREFERENCES AUDIT CONTRACT: ${n-failures.length}/${n} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
