import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = Object.fromEntries([
  ['prefsPanel','src/components/SchedulePreferencesPanel.tsx'],['app','src/App.tsx'],['header','src/components/Header.tsx'],['hero','src/components/HeroBanner.tsx'],
  ['copy','src/content/copy.ts'],['add','src/components/StepAddCourses.tsx'],['results','src/components/StepResults.tsx'],
  ['index','src/index.css'],['types','src/types.ts'],['export','src/utils/exportCalendar.ts'],['meetingTypes','src/utils/meetingTypes.ts'],
].map(([k,f])=>[k,read(f)]));
const failures=[]; let n=0;
function ok(cond,label){n++; if(!cond) failures.push(label);}
// 1-4 hero
ok(src.hero.includes('text-text-secondary') && src.copy.includes("why: 'GADWAL finds you a schedule that actually makes sense.'"),'1 hero solution color/copy present');
ok(src.copy.includes("guide: 'Learn how'"), '2 Learn how copy');
ok(src.hero.includes('text-brand-green') && src.hero.includes('id="hero-btn-how-it-works"'), '3 Learn how green');
ok(!src.app.includes('ScheduleComparisonModal') && !src.header.includes('Example') && !fs.existsSync(path.join(root,'src/components/ScheduleComparisonModal.tsx')), '4 Example modal/header removed');
// 5-7 footer CTAs
ok(src.app.includes('See the screenshot guide') && src.app.includes('See how it works') && src.app.includes('Read our promise'),'5-7 footer CTAs');
// 8-14 screenshot state
ok(!src.add.includes('We read the screenshots together'),'8 removed screenshot explanation');
ok(src.add.includes('responsive-progress-indeterminate'),'9/11 indeterminate progress class');
ok(src.add.includes('<strong>Extracting...</strong>') || src.add.includes("'Extracting...'"),'10 Extracting text');
ok(!src.add.includes('course options found'),'12 no options-found row');
ok(src.add.includes('Couldn’t read this screenshot'),'13 error copy');
ok(src.add.includes('responsive-error-note'),'14 error style hook');
// 15-17 long course names
ok(src.add.includes('break-words') && src.add.includes('whitespace-normal') && src.add.includes('min-w-0'),'15-17 long names');
// 18-20 shortcuts
ok(!src.add.includes('Set all missing to 3 cr') && !src.add.includes('Set remaining credits to 3') && !src.add.includes('handleSetAllPendingCredits') && !src.add.includes('otherCreditsCourseKey'),'18-20 3-credit shortcuts removed');
// 21-24 course code
ok(src.add.includes('Course code *') && src.add.includes('form.courseCode') && src.add.includes('Section code *') && src.add.includes('form.sectionCode') && !src.add.includes('<span>optional</span>'),'21-24 separate course/section code fields');
// 25-27 meeting type options exact in UI
const manualMatch=src.meetingTypes.match(/MANUAL_MEETING_TYPE_OPTIONS = \[(.*?)\]/s);
const manualTypes=manualMatch ? [...manualMatch[1].matchAll(/'([^']+)'/g)].map(m=>m[1]) : [];
ok(['Lecture','Section','Lab','Online','Custom'].every(v=>manualTypes.includes(v)) && manualTypes.length === 5,'25-26 required manual meeting types present');
ok(!['Tutorial','Discussion','Other','Recitation','Seminar','Workshop'].some(v=>manualTypes.includes(v)),'27 no forbidden manual meeting type options');
// 28-33 per meeting
ok(src.add.includes('sessionIndex') && src.add.includes('type: e.target.value as MeetingType') && src.add.includes('customType'),'28-33 per-meeting type/custom state');
// 34-37 add another day
ok(src.add.includes('Add another meeting day') && src.add.includes('handleAddMeetingRow') && src.add.includes('handleAddEditMeeting'),'34-37 add meeting day handlers');
// 38-41 delete option
ok(src.add.includes('handleDeletePendingSection') && src.add.includes('prev.filter((s) => s.id !== targetSec.id)'),'38-41 robust delete option');
// 42-50 screenshot clear/reset
ok(src.add.includes('Remove all screenshots') && src.add.includes('setPendingParsedSections(null)') && src.add.includes('setIsReviewModalOpen(false)') && src.add.includes('sessionRemoveItem(STORAGE_KEY_PENDING_REVIEW)'),'42-50 screenshot reset');
// 51-54 credits
ok(src.prefsPanel.includes('type="number"') && !src.add.includes('[12,13,14,15,16,17,18,19,20].map'),'51-54 numeric credits');
// 55-57 must take
ok(src.prefsPanel.includes('Courses that you want to take no matter what. GADWAL will include these courses in every schedule it creates.') && src.prefsPanel.includes('font-bold text-ink'),'55-57 must-take note/black');
// 58-64 result limit/ranking
ok(src.results.includes('const displayedSchedules = activeSchedules.slice(0, 5);') && src.results.includes('const allRankedSchedules') && src.results.includes('compareSchedules'),'58-64 top 5 and ranking');
// 65-70 full details
ok(src.results.includes("'See full details'") && src.results.includes('Course code:') && src.results.includes('Option:') && src.results.includes('Credits:') && src.results.includes('session.day'),'65-70 full details');
// extra visible wording
ok(!src.export.includes('Section code missing'),'export uses Course code wording');
console.log(`REQUESTED FIX AUDIT: ${n-failures.length}/${n} checks passed`);
if(failures.length){ for(const f of failures) console.error('FAIL:',f); process.exit(1); }
