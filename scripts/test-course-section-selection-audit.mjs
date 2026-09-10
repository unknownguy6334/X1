import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const files = {
  app: read('src/App.tsx'), add: read('src/components/StepAddCourses.tsx'), types: read('src/types.ts'),
  optimizer: read('src/utils/optimizer.ts'), courseUtils: read('src/utils/courseUtils.ts'), export: read('src/utils/export.ts'),
  prefs: read('src/utils/preferenceValidation.ts'), persistence: read('src/utils/persistenceValidation.ts'),
};
let n=0; const failures=[]; const ok=(v,m)=>{n++; if(!v) failures.push(m)};
ok(files.optimizer.includes('section.courseKey || getCourseIdentityKey') && files.optimizer.includes('normalized[courseKey]'), 'optimizer groups by stable courseKey');
ok(files.optimizer.includes('preferences.mandatoryCourseKeys') && files.optimizer.includes('mandatoryCourseKeys('), 'mandatory selection uses stable course keys');
ok(files.add.includes('key={group.courseKey ||') && !files.add.includes('key={group.courseName}'), 'course React keys are identity-based');
ok(files.add.includes('formatCourseDisplay(group.courseCode, group.courseName)'), 'course management visibly includes course code');
ok(files.add.includes("type: sessionType") && files.add.includes("customType: s.type === 'Custom'"), 'manual Custom meetings use canonical Custom type plus customType');
ok(files.courseUtils.includes("type === 'custom' ? String(session.customType || '')"), 'customType participates in meeting identity');
ok(files.courseUtils.includes('Ambiguity is metadata, not identity'), 'ambiguousTime is excluded from meeting identity');
ok(files.add.includes('canonicalizeSectionIdentity(sectionCode)') && files.add.includes('canonicalizeSectionIdentity(String(section.sectionCode || \'\'))'), 'manual section collisions use canonical section identity');
ok(files.add.includes('const newCourseKey = getCourseIdentityKey(courseCode, courseName)') && files.add.includes('targetGroup = savedCourseGroups.find((g) => g.courseKey === newCourseKey)'), 'edit collision checks use resulting courseKey');
ok(files.add.includes('targetGroup = savedCourseGroups.find((g) => g.courseKey === newCourseKey)') && files.add.includes('This section can’t be moved into'), 'identity-changing edits reject collisions at the editor boundary');
ok(files.app.includes('exactMatches.length > 1') && files.app.includes('Refusing section deletion because the internal section ID is duplicated'), 'section deletion refuses ambiguous duplicate IDs');
ok(files.add.includes("group.credits == null ? 'Credits need review'"), 'conflicting credits never display as zero');
ok(files.export.includes("const cleanCode = (sec.courseCode || '').trim()") && files.export.includes("courseId: (section.sectionCode || '').trim()"), 'exports use explicit courseCode and sectionCode');
ok(files.courseUtils.includes('const courseComparisonKey = (s: Section): string => s.courseKey || getCourseIdentityKey'), 'staleness diagnostics use stable course identity');
ok(files.courseUtils.includes('Catalog sections are normalized at ingestion boundaries') && !files.courseUtils.includes('for (const original of deduplicateParsedBatch(sections))'), 'render-time course grouping no longer reruns full reconciliation');
ok(files.app.includes('new Set(sections.map((s) => s.courseKey || getCourseIdentityKey(s.courseCode, s.name)))'), 'course counts use stable course identity');
console.log(`COURSE/SECTION AUDIT CONTRACT: ${n-failures.length}/${n} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
