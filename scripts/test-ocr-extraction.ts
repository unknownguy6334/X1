const assert = {
  equal(actual: unknown, expected: unknown, message?: string) { if (actual !== expected) throw new Error(message || `Expected ${String(expected)}, got ${String(actual)}`); },
  notEqual(actual: unknown, expected: unknown, message?: string) { if (actual === expected) throw new Error(message || `Expected values to differ, both were ${String(actual)}`); },
  deepEqual(actual: unknown, expected: unknown, message?: string) { const a = JSON.stringify(actual); const e = JSON.stringify(expected); if (a !== e) throw new Error(message || `Expected ${e}, got ${a}`); },
  ok(value: unknown, message?: string) { if (!value) throw new Error(message || 'Expected truthy value'); },
};
import { parsePastedText, parseTimeRange, parseDays, extractSessionsFromSegment } from '../src/utils/parser';
import { parseCourseCode, getCourseIdentityKey, isPlaceholderSectionId, deduplicateParsedBatch } from '../src/utils/courseUtils';
import { modelOutputToCanonical, canonicalToAppSections, reconcileOCRSections } from '../src/utils/ocrExtractionCore';
import { normalizeTimeWithPolicy, parseTimeRangeWithPolicy } from '../src/utils/timeParsingPolicy';
import { resolveDayTokens, resolveSessionType } from '../src/utils/scheduleParsing';
import { validateOcrModelShape } from '../src/utils/ocrApiContract';

function section(courseCode: string, sectionCode: string | null, sessions: any[] = [], credits: number | null = 3, name = 'Course') {
  return {
    id: `test:${courseCode}:${sectionCode ?? 'missing'}`,
    name,
    courseKey: getCourseIdentityKey(courseCode, name),
    courseCode,
    sectionCode,
    sectionCodeMissing: !sectionCode,
    credits,
    sessions,
    needsReview: !sectionCode,
    reviewReasons: !sectionCode ? ['section_code_missing'] : [],
    conflictingMeetings: [],
    creditHoursConflict: null,
  } as any;
}

// Identity and section invariants
assert.equal(parseCourseCode('FIN321'), 'FIN 321');
assert.equal(parseCourseCode('FIN-321'), 'FIN 321');
assert.equal(getCourseIdentityKey('FIN 321', 'Corporate Finance'), getCourseIdentityKey('FIN321', 'Corporate Finance'));
assert.notEqual(getCourseIdentityKey('FIN 321', 'Corporate Finance'), getCourseIdentityKey('FIN 322', 'Corporate Finance'));
assert.equal(isPlaceholderSectionId('SEC-01'), false);
assert.equal(isPlaceholderSectionId('New01'), false);
assert.equal(isPlaceholderSectionId('01'), false);

// Time context
assert.deepEqual(parseTimeRange('1:00 - 2:30 PM'), { start: '13:00', end: '14:30' });
assert.deepEqual(parseTimeRange('1:00 PM - 2:30'), { start: '13:00', end: '14:30' });
assert.equal(normalizeTimeWithPolicy('13:00'), '13:00');
assert.equal(parseTimeRange('10:00 AM - 11:30 AM')?.start, '10:00');
assert.equal(parseTimeRange('10:00 AM'), null);
assert.equal(parseTimeRangeWithPolicy('10:00 AM -'), null);

// Day handling
assert.deepEqual(parseDays('MW'), ['MON', 'WED']);
assert.deepEqual(parseDays('M/W'), ['MON', 'WED']);
assert.deepEqual(parseDays('T/Th'), ['TUE', 'THU']);
assert.deepEqual(parseDays('Saturday-Wednesday'), ['SAT', 'WED']);
assert.deepEqual(resolveDayTokens('ST'), []);
assert.deepEqual(resolveDayTokens('السبت الاربعاء'), ['SAT', 'WED']);
assert.deepEqual(resolveDayTokens('ح ن ث ر خ ج س'), ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);

// Meeting types. Unknown is never Lecture.
assert.equal(resolveSessionType('Lecture'), 'Lecture');
assert.equal(resolveSessionType('Lab'), 'Lab');
assert.equal(resolveSessionType('Tutorial'), 'Tutorial');
assert.equal(resolveSessionType('Discussion'), 'Discussion');
assert.equal(resolveSessionType('Recitation'), 'Recitation');
assert.equal(resolveSessionType('mystery institutional type'), 'Other');

// Order independent pasted text. Meeting/time comes before course identity.
const beforeIdentity = parsePastedText(`10:00 AM - 11:30 AM\nMonday / Wednesday\nCorporate Finance\nFIN 321\n01`);
assert.equal(beforeIdentity.length, 1);
assert.equal(beforeIdentity[0].courseCode, 'FIN 321');
assert.equal(beforeIdentity[0].name, 'Corporate Finance');
assert.equal(beforeIdentity[0].sectionCode, '01');
assert.equal(beforeIdentity[0].sessions.length, 2);

const codeBeforeTitle = parsePastedText(`FIN 321\n01\nCorporate Finance\nMW\n1:00 - 2:30 PM`);
assert.equal(codeBeforeTitle.length, 1);
assert.equal(codeBeforeTitle[0].sectionCode, '01');
assert.deepEqual(codeBeforeTitle[0].sessions.map(s => `${s.day}|${s.start}|${s.end}`), [
  'MON|13:00|14:30', 'WED|13:00|14:30'
]);

const incomplete = parsePastedText(`Corporate Finance\nFIN 321\nMW\n10:00 AM - 11:30 AM`);
assert.equal(incomplete.length, 1);
assert.equal(incomplete[0].sectionCode, null);
assert.equal(incomplete[0].sectionCodeMissing, true);
assert.equal(incomplete[0].needsReview, true);
assert.equal(incomplete[0].sessions.length, 2);

// Missing end time remains missing and reviewable.
const missingEnd = modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN 321', code_inferred: false,
  credit_hours: 3, credit_hours_conflict: null, needs_review: false, review_reasons: [],
  sections: [{ section_code: '01', section_code_missing: false, tutorial_code: null, instructor: null,
    part_time: null, needs_review: false, review_reasons: [],
    meetings: [{ day: 'Monday', type: 'Lecture', start_time: '10:00 AM', end_time: null, raw_time: '10:00 AM' }],
    conflicting_meetings: [] }]
}] });
const missingEndApp = canonicalToAppSections(missingEnd);
assert.equal(missingEndApp[0].sessions.length, 0);
assert.ok(missingEndApp[0].reviewReasons?.includes('end_time_missing_or_unrecognized'));

// Unknown type gets Other + review. It does not become Lecture.
const unknownType = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Course', course_code: 'ABC 101', code_inferred: false, credit_hours: 3, credit_hours_conflict: null,
  needs_review: false, review_reasons: [], sections: [{ section_code: '01', section_code_missing: false,
  tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [],
  meetings: [{ day: 'Monday', type: 'Institutional Meetup', start_time: '10:00 AM', end_time: '11:00 AM', raw_time: '10:00 AM - 11:00 AM' }], conflicting_meetings: [] }]
}] }));
assert.equal(unknownType[0].sessions[0].type, 'Other');
assert.ok(unknownType[0].needsReview);

// Explicit section codes stay verbatim and missing section stays null.
const sectionCodes = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Course', course_code: 'ABC 101', code_inferred: false, credit_hours: 3,
  credit_hours_conflict: null, needs_review: false, review_reasons: [], sections: [
    { section_code: 'SEC-01', section_code_missing: false, tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [], meetings: [], conflicting_meetings: [] },
    { section_code: 'New01', section_code_missing: false, tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [], meetings: [], conflicting_meetings: [] },
    { section_code: '01', section_code_missing: false, tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [], meetings: [], conflicting_meetings: [] },
    { section_code: null, section_code_missing: true, tutorial_code: null, instructor: null, part_time: null, needs_review: true, review_reasons: [], meetings: [], conflicting_meetings: [] },
  ]
}] }));
assert.deepEqual(sectionCodes.map(s => s.sectionCode), ['SEC-01', 'New01', '01', null]);
assert.ok(sectionCodes[3].needsReview);

// Different courses sharing section/time never merge.
const monday10 = [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture', ambiguousTime: false }];
const separate = reconcileOCRSections([
  section('FIN 321', '01', monday10, 3, 'Corporate Finance'),
  section('ECN 202', '01', monday10, 3, 'Economics II'),
]);
assert.equal(separate.length, 2);

// Same course + same section exact duplicate dedupes.
const same = reconcileOCRSections([
  section('FIN 321', '01', monday10, 3, 'Corporate Finance'),
  section('FIN 321', '01', monday10, 3, 'Corporate Finance'),
]);
assert.equal(same.length, 1);
assert.equal(same[0].sessions.length, 1);

// Same day/type with different non-overlapping times can coexist; preserve both and flag the unusual context.
const conflict = reconcileOCRSections([
  section('FIN 321', '01', [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture' }], 3, 'Corporate Finance'),
  section('FIN 321', '01', [{ day: 'MON', start: '12:00', end: '13:00', type: 'Lecture' }], 3, 'Corporate Finance'),
]);
assert.equal(conflict.length, 1);
assert.equal(conflict[0].sessions.length, 2);
assert.equal(conflict[0].conflictingMeetings?.length, 2);
assert.ok(conflict[0].needsReview);
assert.ok(conflict[0].reviewReasons?.includes('multiple_same_day_and_type'));

// Truly overlapping same day/type observations remain blocking conflicts while preserving evidence.
const overlappingConflict = reconcileOCRSections([
  section('FIN 321', '01', [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture' }], 3, 'Corporate Finance'),
  section('FIN 321', '01', [{ day: 'MON', start: '10:30', end: '11:30', type: 'Lecture' }], 3, 'Corporate Finance'),
]);
assert.equal(overlappingConflict.length, 1);
assert.equal(overlappingConflict[0].sessions.length, 2);
assert.ok(overlappingConflict[0].reviewReasons?.includes('conflicting_meeting'));
assert.ok(overlappingConflict[0].conflictingMeetings?.length === 2);

// Credit conflict is course wide.
const creditConflict = reconcileOCRSections([
  section('FIN 321', '01', monday10, 3, 'Corporate Finance'),
  section('FIN 321', '02', [{ day: 'TUE', start: '10:00', end: '11:00', type: 'Lecture' }], 4, 'Corporate Finance'),
]);
assert.equal(creditConflict.length, 2);
assert.equal(creditConflict[0].credits, null);
assert.deepEqual(creditConflict[0].creditHoursConflict, [3, 4]);
assert.deepEqual(creditConflict[1].creditHoursConflict, [3, 4]);


assert.equal(parseCourseCode('FIN-321-01'), 'FIN 321');
assert.equal(parseCourseCode('Room 204'), null);
assert.equal(parseCourseCode('10:00 AM - 11:30 AM'), null);
assert.equal(resolveSessionType('Class'), 'Other');

const fused = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN-321-01', code_inferred: false, credit_hours: 3, credit_hours_conflict: null, needs_review: false, review_reasons: [], sections: [{
    section_code: null, section_code_missing: false, tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [],
    meetings: [{ day: 'Monday', type: 'Lecture', start_time: '10:00 AM', end_time: '11:00 AM', raw_time: '10:00 AM - 11:00 AM' }], conflicting_meetings: []
  }]
}] }));
assert.equal(fused[0].courseCode, 'FIN 321');
assert.equal(fused[0].sectionCode, '01');

const courseLevelMeeting = canonicalToAppSections(modelOutputToCanonical({ courses: [{
  course_name: 'Corporate Finance', course_code: 'FIN 321', code_inferred: false, credit_hours: 3, credit_hours_conflict: null, needs_review: false, review_reasons: [],
  meetings: [{ day: 'Monday', type: 'Lecture', start_time: '10:00 AM', end_time: '11:00 AM', raw_time: '10:00 AM - 11:00 AM' }],
  sections: [{ section_code: '01', section_code_missing: false, tutorial_code: null, instructor: null, part_time: null, needs_review: false, review_reasons: [], meetings: [], conflicting_meetings: [] }]
}] }));
assert.equal(courseLevelMeeting.length, 1);
assert.equal(courseLevelMeeting[0].sessions.length, 1);

// Strict model contract: root is courses and nested arrays/types are checked.
assert.equal(validateOcrModelShape({ courses: [] }).valid, true);
assert.equal(validateOcrModelShape({ sections: [] }).valid, false);
assert.equal(validateOcrModelShape({ courses: [{ course_name: 123, sections: [] }] }).valid, false);

// Pipe-delimited rows can contain multiple independent courses; they must not be swallowed by the first code anchor.
const pipeCourses = parsePastedText('FIN 321 | Corporate Finance | 01 | MW | 10:00-11:30 | ECN 202 | Economics II | 02 | T/Th | 08:30-10:00');
assert.ok(pipeCourses.length >= 2);
assert.ok(pipeCourses.some((s: any) => s.courseCode === 'FIN 321' && s.sectionCode === '01'));
assert.ok(pipeCourses.some((s: any) => s.courseCode === 'ECN 202' && s.sectionCode === '02'));

console.log('PASS OCR forensic deterministic tests');
