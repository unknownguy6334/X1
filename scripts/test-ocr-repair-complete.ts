// @ts-ignore Node types are optional in this sandbox test compile.
import assert from 'node:assert/strict';
import {
  modelOutputToCanonical,
  canonicalToAppSections,
  reconcileOCRSections,
  validateOCRSections,
} from '../src/utils/ocrExtractionCore';
import { parseCourseCode, getCourseIdentityKey, isPlaceholderSectionId, sanitizeCourseNameOnly, disentangleCourseAndSection, deduplicateParsedBatch } from '../src/utils/courseUtils';
import { parseTimeRange } from '../src/utils/parser';
import { resolveDayTokens, resolveSessionType } from '../src/utils/scheduleParsing';

const make = (code: string, sectionCode: string | null, name: string, sessions: any[] = [], credits: number | null = 3) => ({
  id: `test:${code}:${sectionCode ?? 'missing'}:${name}`,
  name,
  courseCode: code,
  courseKey: getCourseIdentityKey(code, name),
  sectionCode,
  sectionCodeMissing: !sectionCode,
  credits,
  sessions,
  needsReview: !sectionCode,
  reviewReasons: !sectionCode ? ['section_code_missing'] : [],
  conflictingMeetings: [],
  creditHoursConflict: null,
});

// 1. Course identity is code-first and superficial formatting only.
assert.equal(parseCourseCode('FIN321'), 'FIN 321');
assert.equal(parseCourseCode('FIN-321'), 'FIN 321');
assert.equal(getCourseIdentityKey('FIN 321', 'Corporate Finance'), 'code:FIN321');
assert.notEqual(getCourseIdentityKey('FIN 321', 'Corporate Finance'), getCourseIdentityKey('FIN 322', 'Corporate Finance'));
assert.equal(getCourseIdentityKey('FIN 321', 'Corporate Finance'), getCourseIdentityKey('FIN 321', 'Different Title'));

// 2. Real visible section identifiers are never placeholders.
for (const code of ['01', 'A01', 'SEC-01', 'New01', '001', 'L01']) assert.equal(isPlaceholderSectionId(code), false, code);
assert.equal(sanitizeCourseNameOnly('FIN 321'), 'FIN 321');
assert.deepEqual(disentangleCourseAndSection('Corporate Finance', 'SEC-01'), { name: 'Corporate Finance', id: 'SEC-01', credits: null });

// 3. Fused code may expose a section only because the source string explicitly contains it.
const fused = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN-321-01', credit_hours: 3,
  sections: [{ section_code: null, section_code_missing: true, meetings: [] }],
}] }));
assert.equal(fused[0].courseCode, 'FIN 321');
assert.equal(fused[0].sectionCode, '01');
assert.equal(fused[0].sectionCodeMissing, false);

// 4. Missing section remains null and never turns into a fake visible code.
const missing = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN 321', credit_hours: 3,
  sections: [{ section_code: null, section_code_missing: true, meetings: [] }],
}] }));
assert.equal(missing[0].sectionCode, null);
assert.equal(missing[0].sectionCodeMissing, true);
assert.ok(missing[0].needsReview);
assert.ok(!/^SEC-\d+$/i.test(missing[0].sectionCode ?? ''));

// 5. Missing end time is preserved as incomplete evidence, not fabricated.
const noEnd = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN 321', credit_hours: 3,
  sections: [{ section_code: '01', section_code_missing: false, meetings: [{ day: 'Monday', type: 'Lecture', start_time: '10:00 AM', end_time: null, raw_time: '10:00 AM' }] }],
}] }));
assert.equal(noEnd[0].sessions.length, 0);
assert.equal(noEnd[0].incompleteMeetings?.length, 1);
assert.ok(noEnd[0].reviewReasons?.includes('end_time_missing_or_unrecognized'));

// 6. Contextual PM range is correct.
assert.deepEqual(parseTimeRange('1:00 - 2:30 PM'), { start: '13:00', end: '14:30' });
assert.deepEqual(parseTimeRange('1:00 PM - 2:30'), { start: '13:00', end: '14:30' });
assert.deepEqual(parseTimeRange('13:00 - 14:30'), { start: '13:00', end: '14:30' });
assert.equal(parseTimeRange('10:00 AM'), null);

// 7. Day handling preserves Saturday + Wednesday, not a date range.
assert.deepEqual(resolveDayTokens('MW'), ['MON', 'WED']);
assert.deepEqual(resolveDayTokens('M/W'), ['MON', 'WED']);
assert.deepEqual(resolveDayTokens('T/Th'), ['TUE', 'THU']);
assert.deepEqual(resolveDayTokens('Saturday-Wednesday'), ['SAT', 'WED']);
assert.deepEqual(resolveDayTokens('السبت الاربعاء'), ['SAT', 'WED']);

// 8. Unknown meeting type never becomes Lecture.
assert.equal(resolveSessionType('Lecture'), 'Lecture');
assert.equal(resolveSessionType('Lab'), 'Lab');
assert.equal(resolveSessionType('Tutorial'), 'Tutorial');
assert.equal(resolveSessionType('Discussion'), 'Discussion');
assert.equal(resolveSessionType('Recitation'), 'Recitation');
assert.equal(resolveSessionType('Institutional Meetup'), 'Other');

// 9. Different course + same section + same meeting remain separate.
const sameMeeting = [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture', ambiguousTime: false }];
const distinctCourses = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', sameMeeting),
  make('ECN 202', '01', 'Economics II', sameMeeting),
]);
assert.equal(distinctCourses.length, 2);

// 10. Same course + same section exact duplicate collapses; different-time contradiction is preserved.
const duplicate = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', sameMeeting),
  make('FIN 321', '01', 'Corporate Finance', sameMeeting),
]);
assert.equal(duplicate.length, 1);
assert.equal(duplicate[0].sessions.length, 1);

const conflict = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture' }]),
  make('FIN 321', '01', 'Corporate Finance', [{ day: 'MON', start: '12:00', end: '13:00', type: 'Lecture' }]),
]);
assert.equal(conflict.length, 1);
assert.equal(conflict[0].sessions.length, 2);
assert.equal(conflict[0].conflictingMeetings?.length, 2);
assert.ok(conflict[0].needsReview);
assert.ok(conflict[0].reviewReasons?.includes('multiple_same_day_and_type'));

const overlappingConflict = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture' }]),
  make('FIN 321', '01', 'Corporate Finance', [{ day: 'MON', start: '10:30', end: '11:30', type: 'Lecture' }]),
]);
assert.equal(overlappingConflict.length, 1);
assert.equal(overlappingConflict[0].sessions.length, 2);
assert.ok(overlappingConflict[0].reviewReasons?.includes('conflicting_meeting'));

// 11. Course credit conflict is explicit and course-wide.
const creditConflict = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', sameMeeting, 3),
  make('FIN 321', '02', 'Corporate Finance', [{ day: 'TUE', start: '10:00', end: '11:00', type: 'Lecture' }], 4),
]);
assert.equal(creditConflict[0].credits, null);
assert.deepEqual(creditConflict[0].creditHoursConflict, [3, 4]);
assert.deepEqual(creditConflict[1].creditHoursConflict, [3, 4]);

// 12. Two title variants under the same code do not silently overwrite one another.
const titleConflict = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', sameMeeting),
  make('FIN 321', '01', 'Corporate Finance & Investments', sameMeeting),
]);
assert.equal(titleConflict.length, 1);
assert.ok(titleConflict[0].needsReview);
assert.ok(titleConflict[0].reviewReasons?.includes('course_name_conflict'));

// 13. Missing-section duplicates collapse only when their complete evidence fingerprints match.
const missingBatch = deduplicateParsedBatch([
  make('FIN 321', null, 'Corporate Finance', sameMeeting),
  make('FIN 321', null, 'Corporate Finance', sameMeeting),
  make('FIN 321', null, 'Corporate Finance', [{ day: 'TUE', start: '10:00', end: '11:00', type: 'Lecture' }]),
]);
assert.equal(missingBatch.length, 2);
assert.equal(missingBatch.filter((s) => s.sectionCodeMissing).length, 2);
assert.equal(missingBatch.every((s) => s.sectionCode === null), true);

// 14. Split-image evidence can complete a real section without fabricating a code.
const splitImage = reconcileOCRSections([
  make('FIN 321', '01', 'Corporate Finance', [], 3),
  make('FIN 321', null, 'Corporate Finance', [{ day: 'MON', start: '13:00', end: '14:30', type: 'Lecture' }], 3),
]);
assert.equal(splitImage.length, 1);
assert.equal(splitImage[0].sectionCode, '01');
assert.equal(splitImage[0].sectionCodeMissing, false);
assert.equal(splitImage[0].sessions.length, 1);

// 15. Incomplete meeting evidence survives client reconciliation.
const incompleteEvidence = make('FIN 321', '01', 'Corporate Finance', [], 3) as any;
incompleteEvidence.incompleteMeetings = [{ raw: { day: 'Monday', start_time: '10:00 AM' }, reasonCodes: ['end_time_missing_or_unrecognized'] }];
const incompleteDedup = deduplicateParsedBatch([incompleteEvidence]);
assert.equal(incompleteDedup.length, 1);
assert.equal(incompleteDedup[0].incompleteMeetings?.length, 1);

// 16. Model contract allows courses with missing optional identity/meeting fields, but canonical validation rejects no identity.
assert.equal(validateOCRSections(noEnd).valid, true);
const noIdentity = canonicalToAppSections(modelOutputToCanonical({ courses: [{ course_name: null, course_code: null, credit_hours: null, sections: [{ section_code: null, meetings: [] }] }] }));
assert.equal(validateOCRSections(noIdentity).valid, false);

console.log('PASS OCR REPAIR COMPLETE TESTS');
