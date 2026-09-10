import assert from 'node:assert/strict';
import {
  modelOutputToCanonical,
  canonicalToAppSections,
  reconcileOCRSections,
  validateOCRSections,
  getLegacySectionCode,
  adaptLegacyOcrPayload,
  buildCourseKey,
  formatCourseDisplay,
} from '../src/utils/ocrExtractionCore';
import { parseTimeRange } from '../src/utils/parser';
import { resolveDayTokens, resolveSessionType } from '../src/utils/scheduleParsing';
import { groupSectionsByCourse } from '../src/utils/courseUtils';
import type { Section, Session } from '../src/types';

console.log('--- STARTING 37 REGRESSION TESTS & CANONICAL SCENARIOS ---');

const makeSection = (
  courseCode: string | null,
  sectionCode: string | null,
  courseName: string,
  sessions: Session[] = [],
  credits: number | null = 3
): Section => ({
  id: `test:${courseCode ?? 'no_code'}:${sectionCode ?? 'missing'}:${courseName}`,
  name: courseName,
  courseCode,
  courseKey: buildCourseKey(courseCode, courseName),
  sectionCode,
  sectionCodeMissing: !sectionCode,
  credits,
  sessions,
  needsReview: !sectionCode,
  reviewReasons: !sectionCode ? ['section_code_missing'] : [],
  conflictingMeetings: [],
  creditHoursConflict: null,
});

// ============================================================================
// SUITE 1: SECTION CODE PRESERVATION (Tests 1 - 13)
// ============================================================================

// 1. id = "01" -> sectionCode = "01"
assert.equal(getLegacySectionCode({ id: '01' }), '01');
const s1 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: '01', meetings: [] }] }]
}));
assert.equal(s1[0].sectionCode, '01');
assert.equal(s1[0].sectionCodeMissing, false);

// 2. id = "1" -> sectionCode = "1"
assert.equal(getLegacySectionCode({ id: '1' }), '1');
const s2 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: '1', meetings: [] }] }]
}));
assert.equal(s2[0].sectionCode, '1');

// 3. id = "A1" -> sectionCode = "A1"
assert.equal(getLegacySectionCode({ id: 'A1' }), 'A1');
const s3 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: 'A1', meetings: [] }] }]
}));
assert.equal(s3[0].sectionCode, 'A1');

// 4. id = "Sec 1" -> sectionCode = "Sec 1"
assert.equal(getLegacySectionCode({ id: 'Sec 1' }), 'Sec 1');
const s4 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: 'Sec 1', meetings: [] }] }]
}));
assert.equal(s4[0].sectionCode, 'Sec 1');

// 5. id = "Section 1" -> sectionCode = "Section 1"
assert.equal(getLegacySectionCode({ id: 'Section 1' }), 'Section 1');
const s5 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: 'Section 1', meetings: [] }] }]
}));
assert.equal(s5[0].sectionCode, 'Section 1');

// 6. id = "SEC-01" -> sectionCode = "SEC-01"
assert.equal(getLegacySectionCode({ id: 'SEC-01' }), 'SEC-01');
const s6 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: 'SEC-01', meetings: [] }] }]
}));
assert.equal(s6[0].sectionCode, 'SEC-01');

// 7. id = "STA31101-BI" -> sectionCode = "STA31101-BI"
assert.equal(getLegacySectionCode({ id: 'STA31101-BI' }), 'STA31101-BI');
const s7 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: null, course_name: 'Statistics', sections: [{ section_code: 'STA31101-BI', meetings: [] }] }]
}));
assert.equal(s7[0].sectionCode, 'STA31101-BI');
assert.equal(s7[0].courseCode, null, 'Never automatically extract BI or STA as course code unless explicit');

// 8. id = "STA31103" -> sectionCode = "STA31103"
assert.equal(getLegacySectionCode({ id: 'STA31103' }), 'STA31103');
const s8 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: null, course_name: 'Statistics', sections: [{ section_code: 'STA31103', meetings: [] }] }]
}));
assert.equal(s8[0].sectionCode, 'STA31103');

// 9. id = "FIN434-New01" -> sectionCode = "FIN434-New01"
assert.equal(getLegacySectionCode({ id: 'FIN434-New01' }), 'FIN434-New01');
const s9 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: null, course_name: 'Finance Seminar', sections: [{ section_code: 'FIN434-New01', meetings: [] }] }]
}));
assert.equal(s9[0].sectionCode, 'FIN434-New01');

// 10. id = "FIN434-New03" -> sectionCode = "FIN434-New03"
assert.equal(getLegacySectionCode({ id: 'FIN434-New03' }), 'FIN434-New03');
const s10 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: null, course_name: 'Finance Seminar', sections: [{ section_code: 'FIN434-New03', meetings: [] }] }]
}));
assert.equal(s10[0].sectionCode, 'FIN434-New03');

// 11. id = "New01" -> sectionCode = "New01"
assert.equal(getLegacySectionCode({ id: 'New01' }), 'New01');
const s11 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 434', course_name: 'Finance Seminar', sections: [{ section_code: 'New01', meetings: [] }] }]
}));
assert.equal(s11[0].sectionCode, 'New01');

// 12. missing id -> sectionCode = null
const s12 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{ course_code: 'FIN 321', course_name: 'Corporate Finance', sections: [{ section_code: null, section_code_missing: true, meetings: [] }] }]
}));
assert.equal(s12[0].sectionCode, null);

// 13. missing id -> sectionCodeMissing = true
assert.equal(s12[0].sectionCodeMissing, true);
assert.equal(s12[0].needsReview, true);

console.log('Passed Suite 1: Section Code Preservation (Tests 1-13)');

// ============================================================================
// SUITE 2: IDENTITY TESTS (Tests 14 - 18)
// ============================================================================

// 14. Two different courses, both section 01 -> remain separate
const s14A = makeSection('MATH 101', '01', 'Calculus I');
const s14B = makeSection('ECON 202', '01', 'Macroeconomics');
const res14 = reconcileOCRSections([s14A, s14B]);
assert.equal(res14.length, 2);
assert.notEqual(res14[0].courseCode, res14[1].courseCode);

// 15. Two different courses, same exact meeting time -> remain separate
const meeting10 = [{ id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' }];
const s15A = makeSection('MATH 101', '01', 'Calculus I', meeting10);
const s15B = makeSection('ECON 202', '01', 'Macroeconomics', meeting10);
const res15 = reconcileOCRSections([s15A, s15B]);
assert.equal(res15.length, 2);
const groups15 = groupSectionsByCourse(res15);
assert.equal(groups15.length, 2);

// 16. Same course code, different OCR title spelling -> merge
const s16A = makeSection('FIN 321', '01', 'Corporate Finance', meeting10);
const s16B = makeSection('FIN 321', '01', 'Corporat Finance', meeting10);
const res16 = reconcileOCRSections([s16A, s16B]);
assert.equal(res16.length, 1);
assert.equal(res16[0].courseCode, 'FIN 321');
assert.equal(res16[0].name, 'Corporate Finance');

// 17. Same title, different course codes -> remain separate
const s17A = makeSection('FIN 321', '01', 'Corporate Finance', meeting10);
const s17B = makeSection('FIN 421', '01', 'Corporate Finance', meeting10);
const res17 = reconcileOCRSections([s17A, s17B]);
assert.equal(res17.length, 2);

// 18. Same course code with missing title in one screenshot -> merge
const s18A = makeSection('FIN 321', '01', 'Corporate Finance', meeting10);
const s18B = makeSection('FIN 321', '01', '', meeting10);
const res18 = reconcileOCRSections([s18A, s18B]);
assert.equal(res18.length, 1);
assert.equal(res18[0].name, 'Corporate Finance');

console.log('Passed Suite 2: Identity Tests (Tests 14-18)');

// ============================================================================
// SUITE 3: MEETING TESTS (Tests 19 - 23)
// ============================================================================

// 19. Lecture + Lab under same section -> both remain
const s19 = makeSection('CHEM 101', '01', 'General Chemistry', [
  { id: 'm1', day: 'MON' as const, start: '09:00', end: '10:00', type: 'Lecture' },
  { id: 'm2', day: 'WED' as const, start: '14:00', end: '17:00', type: 'Lab' },
]);
const res19 = reconcileOCRSections([s19]);
assert.equal(res19[0].sessions.length, 2);
assert.equal(res19[0].sessions.filter((m) => m.type === 'Lecture').length, 1);
assert.equal(res19[0].sessions.filter((m) => m.type === 'Lab').length, 1);

// 20. Exact duplicate meeting -> dedupe
const s20A = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
]);
const s20B = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm2', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
]);
const res20 = reconcileOCRSections([s20A, s20B]);
assert.equal(res20.length, 1);
assert.equal(res20[0].sessions.length, 1);

// 21. Same day/type with different time -> conflict
const s21A = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
]);
const s21B = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm2', day: 'MON' as const, start: '14:00', end: '15:00', type: 'Lecture' },
]);
const res21 = reconcileOCRSections([s21A, s21B]);
assert.equal(res21.length, 1);
assert.equal(res21[0].sessions.length, 0);
assert.equal(res21[0].conflictingMeetings?.length, 2);
assert.equal(res21[0].needsReview, true);

// 22. Unknown meeting type -> Other + needsReview
assert.equal(resolveSessionType('Institutional Meetup'), 'Other');
assert.equal(resolveSessionType('SeminarWorkshop'), 'Other');
const s22 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_code: 'FIN 321',
    course_name: 'Corporate Finance',
    sections: [{
      section_code: '01',
      meetings: [{ day: 'Monday', start_time: '10:00 AM', end_time: '11:00 AM', type: 'Institutional Meetup' }],
    }],
  }],
}));
assert.equal(s22[0].sessions[0].type, 'Other');
assert.equal(s22[0].needsReview, true);

// 23. Missing end time -> end = null, never +1 hour
const s23 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_code: 'FIN 321',
    course_name: 'Corporate Finance',
    sections: [{
      section_code: '01',
      meetings: [{ day: 'Monday', start_time: '10:00 AM', end_time: null, raw_time: '10:00 AM' }],
    }],
  }],
}));
assert.equal(s23[0].sessions.length, 0);
assert.equal(s23[0].incompleteMeetings?.length, 1);
assert.ok(s23[0].needsReview);

console.log('Passed Suite 3: Meeting Tests (Tests 19-23)');

// ============================================================================
// SUITE 4: TIME PARSING TESTS (Tests 24 - 28)
// ============================================================================

// 24. 1:00 - 2:30 PM -> 13:00 - 14:30
assert.deepEqual(parseTimeRange('1:00 - 2:30 PM'), { start: '13:00', end: '14:30' });

// 25. 10:00 AM - 11:30 AM -> 10:00 - 11:30
assert.deepEqual(parseTimeRange('10:00 AM - 11:30 AM'), { start: '10:00', end: '11:30' });

// 26. 13:00 - 14:30 -> unchanged
assert.deepEqual(parseTimeRange('13:00 - 14:30'), { start: '13:00', end: '14:30' });

// 27. 01:00 without AM/PM -> ambiguous/review
const s27 = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_name: 'Corporate Finance',
    course_code: 'FIN 321',
    sections: [{
      section_code: '01',
      meetings: [{ day: 'Monday', start_time: '01:00', end_time: '02:30', type: 'Lecture' }],
    }],
  }],
}));
assert.equal(s27[0].sessions.length, 0);
assert.equal(s27[0].incompleteMeetings?.length, 1);
assert.equal(s27[0].needsReview, true);
assert.ok(s27[0].reviewReasons?.includes('ambiguous_meeting_time') || s27[0].reviewReasons?.includes('ambiguous_time'));

// 28. 01:00 PM -> 13:00
assert.deepEqual(parseTimeRange('01:00 PM - 02:00 PM'), { start: '13:00', end: '14:00' });

console.log('Passed Suite 4: Time Parsing Tests (Tests 24-28)');

// ============================================================================
// SUITE 5: COURSE BEHAVIOR (Tests 29 - 32)
// ============================================================================

// 29. Course with exactly one section -> remains one section
const s29 = [makeSection('FIN 321', '01', 'Corporate Finance')];
const res29 = reconcileOCRSections(s29);
assert.equal(res29.length, 1);
assert.equal(groupSectionsByCourse(res29).length, 1);

// 30. Course with no visible section -> sectionCode null + review state
const s30 = [makeSection('FIN 321', null, 'Corporate Finance')];
const res30 = reconcileOCRSections(s30);
assert.equal(res30[0].sectionCode, null);
assert.equal(res30[0].sectionCodeMissing, true);
assert.equal(res30[0].needsReview, true);

// 31. Course with two sections -> two sections, one course
const s31 = [
  makeSection('FIN 321', '01', 'Corporate Finance'),
  makeSection('FIN 321', '02', 'Corporate Finance'),
];
const res31 = reconcileOCRSections(s31);
assert.equal(res31.length, 2);
const groups31 = groupSectionsByCourse(res31);
assert.equal(groups31.length, 1);
assert.equal(groups31[0].sections.length, 2);

// 32. Course code + name -> combined display identity
assert.equal(formatCourseDisplay('FIN 321', 'Corporate Finance'), 'FIN 321 · Corporate Finance');
assert.equal(formatCourseDisplay('FIN 321', 'FIN 321 · Corporate Finance'), 'FIN 321 · Corporate Finance');
assert.equal(formatCourseDisplay('FIN 321', null), 'FIN 321');
assert.equal(formatCourseDisplay(null, 'Corporate Finance'), 'Corporate Finance');

console.log('Passed Suite 5: Course Behavior Tests (Tests 29-32)');

// ============================================================================
// SUITE 6: MULTI-IMAGE TESTS (Tests 33 - 37)
// ============================================================================

// 33. Header in image A + meeting row in image B -> one section
const imgA = makeSection('FIN 321', '01', 'Corporate Finance', [], 3);
const imgB = makeSection('FIN 321', null, 'Corporate Finance', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
], 3);
const res33 = reconcileOCRSections([imgA, imgB]);
assert.equal(res33.length, 1);
assert.equal(res33[0].sectionCode, '01');
assert.equal(res33[0].sessions.length, 1);

// 34. Same screenshot uploaded twice -> no duplicate section
const twiceA = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
]);
const twiceB = makeSection('FIN 321', '01', 'Corporate Finance', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' },
]);
const res34 = reconcileOCRSections([twiceA, twiceB]);
assert.equal(res34.length, 1);

// 35. Four screenshots in one request -> one consolidated dataset
const fourImages = [
  makeSection('FIN 321', '01', 'Corporate Finance', [{ id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' }]),
  makeSection('FIN 321', '02', 'Corporate Finance', [{ id: 'm2', day: 'TUE' as const, start: '10:00', end: '11:00', type: 'Lecture' }]),
  makeSection('ECN 202', '01', 'Macroeconomics', [{ id: 'm3', day: 'WED' as const, start: '14:00', end: '15:30', type: 'Lecture' }]),
  makeSection('MKT 301', '01', 'Marketing Principles', [{ id: 'm4', day: 'THU' as const, start: '12:00', end: '13:30', type: 'Lecture' }]),
];
const res35 = reconcileOCRSections(fourImages);
assert.equal(res35.length, 4);
const groups35 = groupSectionsByCourse(res35);
assert.equal(groups35.length, 3);

// 36. Five+ screenshots -> chunk + global identity reconciliation
const chunk1 = reconcileOCRSections([
  makeSection('FIN 321', '01', 'Corporate Finance', [{ id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' }]),
  makeSection('ECN 202', '01', 'Macroeconomics', [{ id: 'm2', day: 'WED' as const, start: '14:00', end: '15:30', type: 'Lecture' }]),
]);
const chunk2 = reconcileOCRSections([
  makeSection('FIN 321', '01', 'Corporate Finance', [{ id: 'm1', day: 'MON' as const, start: '10:00', end: '11:00', type: 'Lecture' }]), // duplicate from chunk 1
  makeSection('FIN 321', '02', 'Corporate Finance', [{ id: 'm3', day: 'TUE' as const, start: '10:00', end: '11:00', type: 'Lecture' }]),
  makeSection('ACC 101', '01', 'Accounting I', [{ id: 'm4', day: 'THU' as const, start: '08:00', end: '09:30', type: 'Lecture' }]),
]);
const globalReconciliation = reconcileOCRSections([...chunk1, ...chunk2]);
assert.equal(globalReconciliation.length, 4); // FIN 321 (01, 02), ECN 202 (01), ACC 101 (01)
const globalGroups = groupSectionsByCourse(globalReconciliation);
assert.equal(globalGroups.length, 3);
const finGroup = globalGroups.find((g) => g.courseCode === 'FIN 321');
assert.equal(finGroup?.sections.length, 2);

// 37. Different courses with same section number across images -> remain separate
const res37 = reconcileOCRSections([
  makeSection('FIN 321', '01', 'Corporate Finance'),
  makeSection('ECN 202', '01', 'Macroeconomics'),
  makeSection('ACC 101', '01', 'Accounting I'),
]);
assert.equal(res37.length, 3);
const groups37 = groupSectionsByCourse(res37);
assert.equal(groups37.length, 3);

console.log('Passed Suite 6: Multi-Image Tests (Tests 33-37)');

// ============================================================================
// SUITE 7: CANONICAL EXTRACTION SCENARIOS A - E (Section 32)
// ============================================================================

// Scenario A: Standard Course with Known Code, Title, Section, and Days
const scenA = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_name: 'Corporate Finance',
    course_code: 'FIN 321',
    credit_hours: 3,
    sections: [{
      section_code: '01',
      section_code_missing: false,
      meetings: [{ day: 'Monday, Wednesday', start_time: '1:00 PM', end_time: '2:30 PM', type: 'Lecture' }],
    }],
  }],
}));
assert.equal(scenA.length, 1);
assert.equal(scenA[0].courseCode, 'FIN 321');
assert.equal(scenA[0].sectionCode, '01');
assert.equal(scenA[0].sessions.length, 2);
assert.equal(scenA[0].sessions[0].start, '13:00');
assert.equal(scenA[0].sessions[0].end, '14:30');
assert.equal(scenA[0].needsReview, false);

// Scenario B: Multiple Sections under One Course Header
const scenB = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_name: 'Statistics for Business',
    course_code: 'STA 201',
    credit_hours: 4,
    sections: [
      { section_code: 'A01', meetings: [{ day: 'Tuesday', start_time: '10:00 AM', end_time: '11:30 AM', type: 'Lecture' }] },
      { section_code: 'A02', meetings: [{ day: 'Thursday', start_time: '10:00 AM', end_time: '11:30 AM', type: 'Lecture' }] },
    ],
  }],
}));
assert.equal(scenB.length, 2);
const groupsB = groupSectionsByCourse(scenB);
assert.equal(groupsB.length, 1);
assert.equal(groupsB[0].sections.length, 2);

// Scenario C: Split-Image Table (Header in Screenshot 1, Meeting in Screenshot 2)
const scenC1 = makeSection('MGT 300', 'SEC-01', 'Organizational Behavior', [], 3);
const scenC2 = makeSection('MGT 300', null, 'Organizational Behavior', [
  { id: 'm1', day: 'MON' as const, start: '10:00', end: '11:30', type: 'Lecture' },
], 3);
const scenC = reconcileOCRSections([scenC1, scenC2]);
assert.equal(scenC.length, 1);
assert.equal(scenC[0].sectionCode, 'SEC-01');
assert.equal(scenC[0].sectionCodeMissing, false);
assert.equal(scenC[0].sessions.length, 1);

// Scenario D: Ambiguous Time with No AM/PM Marker
const scenD = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_name: 'Marketing Principles',
    course_code: 'MKT 201',
    sections: [{
      section_code: '01',
      meetings: [{ day: 'Monday', start_time: '01:00', end_time: '02:30', type: 'Lecture' }],
    }],
  }],
}));
assert.equal(scenD.length, 1);
assert.equal(scenD[0].sessions.length, 0); // Not guessed as 13:00 or 01:00
assert.equal(scenD[0].incompleteMeetings?.length, 1);
assert.equal(scenD[0].needsReview, true);

// Scenario E: No Section Code Visible
const scenE = canonicalToAppSections(modelOutputToCanonical({
  courses: [{
    course_name: 'Intro to Philosophy',
    course_code: 'PHI 101',
    credit_hours: 3,
    sections: [{
      section_code: null,
      section_code_missing: true,
      meetings: [{ day: 'Wednesday', start_time: '15:00', end_time: '16:30', type: 'Lecture' }],
    }],
  }],
}));
assert.equal(scenE.length, 1);
assert.equal(scenE[0].sectionCode, null);
assert.equal(scenE[0].sectionCodeMissing, true);
assert.equal(scenE[0].needsReview, true);
assert.ok(scenE[0].reviewReasons?.includes('section_code_missing'));

console.log('Passed Suite 7: Canonical Extraction Scenarios A - E');

// ============================================================================
// SUITE 8: LEGACY RESPONSE FORMAT ADAPTER (Section 27)
// ============================================================================
const legacyPayload = {
  sections: [
    {
      id: 'Sec 1',
      name: 'Corporate Finance',
      course_code: 'FIN 321',
      credits: 3,
      sessions: [{ day: 'MON', start: '10:00', end: '11:00', type: 'Lecture' }],
    },
    {
      id: 'STA31101-BI',
      name: 'Statistics',
      credits: 4,
      sessions: [{ day: 'WED', start: '14:00', end: '16:00', type: 'Lecture' }],
    },
  ],
};
const adapted = adaptLegacyOcrPayload(legacyPayload);
assert.equal(adapted.courses.length, 2);
const legacySections = canonicalToAppSections(modelOutputToCanonical(legacyPayload));
assert.equal(legacySections.length, 2);
assert.equal(legacySections[0].sectionCode, 'Sec 1');
assert.equal(legacySections[0].courseCode, 'FIN 321');
assert.equal(legacySections[1].sectionCode, 'STA31101-BI');
assert.equal(legacySections[1].credits, 4);

console.log('Passed Suite 8: Legacy Format Adapter (Section 27)');

console.log('\n======================================================');
console.log('ALL 37 SPEC REGRESSION TESTS & SCENARIOS PASSED 100%!');
console.log('======================================================');
