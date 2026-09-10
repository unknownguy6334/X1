import assert from 'node:assert/strict';
import {
  canonicalizeSectionIdentity,
  canonicalizeDisplaySectionCode,
  getCanonicalSectionKey,
  getResolvedSectionIdentity,
  mergeDuplicateCanonicalSections,
} from '../src/utils/courseCodeRelation';
import {
  reconcileOCRSections,
  mergeSectionLosslessly as ocrMergeLosslessly,
} from '../src/utils/ocrExtractionCore';
import {
  deduplicateSections,
  deduplicateParsedBatch,
} from '../src/utils/courseUtils';
import type { Section } from '../src/types';

console.log('=== RUNNING SECTION 3 DETERMINISTIC CANONICAL IDENTITY REGRESSION TESTS ===');

// --- Test 1: Normalization Rules 1-10 ---
console.log('Running Test 1: Normalization Rules 1-10');
// 1 & 2. Leading and trailing whitespace
assert.equal(canonicalizeSectionIdentity('  FIN434-New01  '), 'FIN434-NEW01');
// 3. Repeated internal whitespace
assert.equal(canonicalizeSectionIdentity('FIN434   New01'), 'FIN434 NEW01');
// 4 & 5. Whitespace before and after separators
assert.equal(canonicalizeSectionIdentity('FIN434 - New01'), 'FIN434-NEW01');
assert.equal(canonicalizeSectionIdentity('FIN434- New01'), 'FIN434-NEW01');
assert.equal(canonicalizeSectionIdentity('FIN434 -New01'), 'FIN434-NEW01');
// 6. Case normalization
assert.equal(canonicalizeSectionIdentity('fin434-new01'), 'FIN434-NEW01');
// 7. Dashes / Hyphens (en-dash, em-dash, fullwidth hyphen)
assert.equal(canonicalizeSectionIdentity('FIN434\u2013New01'), 'FIN434-NEW01'); // en-dash
assert.equal(canonicalizeSectionIdentity('FIN434\u2014New01'), 'FIN434-NEW01'); // em-dash
assert.equal(canonicalizeSectionIdentity('FIN434 \uFF0D New01'), 'FIN434-NEW01'); // fullwidth hyphen
// 8 & 9. Underscore and slash separators
assert.equal(canonicalizeSectionIdentity('SEC _ 01'), 'SEC_01');
assert.equal(canonicalizeSectionIdentity('SEC / 01'), 'SEC/01');
// 10. Unicode whitespace
assert.equal(canonicalizeSectionIdentity('FIN434\u00A0-\u00A0New01'), 'FIN434-NEW01'); // non-breaking space
assert.equal(canonicalizeSectionIdentity('FIN434\u3000-\u3000New01'), 'FIN434-NEW01'); // ideographic space
console.log('✓ Test 1 Passed: All 10 Normalization Rules produce expected canonical keys.');

// --- Test 2: Display Code Normalization ---
console.log('Running Test 2: Display Code Normalization');
assert.equal(canonicalizeDisplaySectionCode('FIN434 - New01'), 'FIN434-New01');
assert.equal(canonicalizeDisplaySectionCode('  FIN434- New01  '), 'FIN434-New01');
assert.equal(canonicalizeDisplaySectionCode('SEC / 01'), 'SEC/01');
assert.equal(canonicalizeDisplaySectionCode(''), null);
assert.equal(canonicalizeDisplaySectionCode(null), null);
console.log('✓ Test 2 Passed: Display code normalization preserves character case while cleaning separators.');

// --- Test 3: Meaningful Differences Preserved ---
console.log('Running Test 3: Meaningful Differences Preserved');
assert.notEqual(canonicalizeSectionIdentity('FIN434-New01'), canonicalizeSectionIdentity('FIN434-New03'));
assert.notEqual(canonicalizeSectionIdentity('A-01'), canonicalizeSectionIdentity('A-02'));
assert.notEqual(canonicalizeSectionIdentity('SEC-01'), canonicalizeSectionIdentity('SEC-02'));
assert.notEqual(canonicalizeSectionIdentity('01'), canonicalizeSectionIdentity('02'));
assert.notEqual(canonicalizeSectionIdentity('BIM32108-BUS'), canonicalizeSectionIdentity('BIM3210801-BUS'));
console.log('✓ Test 3 Passed: Meaningful identifier distinctions are strictly preserved.');

// --- Test 4: Reconcile OCR formatting variants into exactly 2 sections ---
console.log('Running Test 4: Reconcile OCR formatting variants into exactly 2 sections');
const ocrInputSections: Section[] = [
  {
    id: 's1',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    courseKey: 'code:fin434',
    sectionCode: 'FIN434-New01',
    rawSectionCode: 'FIN434-New01',
    credits: 3,
    sessions: [{ id: 'm1', day: 'MON', start: '09:00', end: '10:15', type: 'Lecture' }],
  },
  {
    id: 's2',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    courseKey: 'code:fin434',
    sectionCode: 'FIN434-New03',
    rawSectionCode: 'FIN434-New03',
    credits: 3,
    sessions: [{ id: 'm2', day: 'TUE', start: '11:00', end: '12:15', type: 'Lecture' }],
  },
  {
    id: 's3',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    courseKey: 'code:fin434',
    sectionCode: 'FIN434 - New01',
    rawSectionCode: 'FIN434 - New01',
    credits: 3,
    sessions: [{ id: 'm3', day: 'MON', start: '09:00', end: '10:15', type: 'Lecture' }],
  },
  {
    id: 's4',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    courseKey: 'code:fin434',
    sectionCode: 'FIN434 - New03',
    rawSectionCode: 'FIN434 - New03',
    credits: 3,
    sessions: [{ id: 'm4', day: 'TUE', start: '11:00', end: '12:15', type: 'Lecture' }],
  },
];

const reconciled = reconcileOCRSections(ocrInputSections);
assert.equal(reconciled.length, 2, `Expected exactly 2 reconciled sections, got ${reconciled.length}`);

const sec01 = reconciled.find((s) => s.canonicalSectionKey === 'FIN434-NEW01' || s.sectionCode === 'FIN434-New01');
const sec03 = reconciled.find((s) => s.canonicalSectionKey === 'FIN434-NEW03' || s.sectionCode === 'FIN434-New03');

assert.ok(sec01, 'Section FIN434-New01 must be present');
assert.ok(sec03, 'Section FIN434-New03 must be present');
assert.equal(sec01.sessions.length, 1, 'Duplicate meeting on FIN434-New01 must be deduplicated to 1');
assert.equal(sec03.sessions.length, 1, 'Duplicate meeting on FIN434-New03 must be deduplicated to 1');

// Raw variants retained
assert.ok(sec01.rawSectionCodeVariants?.includes('FIN434-New01'));
assert.ok(sec01.rawSectionCodeVariants?.includes('FIN434 - New01'));
assert.ok(sec03.rawSectionCodeVariants?.includes('FIN434-New03'));
assert.ok(sec03.rawSectionCodeVariants?.includes('FIN434 - New03'));

console.log('✓ Test 4 Passed: 4 OCR records with formatting variants merged cleanly into 2 distinct sections.');

// --- Test 5: deduplicateParsedBatch merges formatting variants ---
console.log('Running Test 5: deduplicateParsedBatch merges formatting variants');
const batchResult = deduplicateParsedBatch(ocrInputSections);
assert.equal(batchResult.length, 2, `Expected 2 sections from deduplicateParsedBatch, got ${batchResult.length}`);
console.log('✓ Test 5 Passed: deduplicateParsedBatch cleanly consolidates formatting duplicates.');

// --- Test 6: deduplicateSections merges incoming format variant into existing catalog section ---
console.log('Running Test 6: deduplicateSections merges incoming format variant into existing catalog');
const existingCatalog: Section[] = [
  {
    id: 'catalog-1',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    sectionCode: 'FIN434-New01',
    credits: 3,
    sessions: [{ id: 'm1', day: 'MON', start: '09:00', end: '10:15', type: 'Lecture' }],
  },
];

const incomingFromOcr: Section[] = [
  {
    id: 'incoming-1',
    name: 'Corporate Finance',
    courseCode: 'FIN434',
    sectionCode: 'FIN434 - New01',
    rawSectionCode: 'FIN434 - New01',
    credits: 3,
    sessions: [
      { id: 'm1', day: 'MON', start: '09:00', end: '10:15', type: 'Lecture' },
      { id: 'm2', day: 'WED', start: '09:00', end: '10:15', type: 'Lecture' },
    ],
  },
];

const dedupeResult = deduplicateSections(existingCatalog, incomingFromOcr);
assert.equal(dedupeResult.insertedSections.length, 0, 'No new section should be inserted (must recognize existing section)');
assert.equal(dedupeResult.updatedSections.length, 1, 'Existing section must be updated with new Wednesday meeting');
assert.equal(dedupeResult.updatedAllSections.length, 1, 'Catalog size must remain 1');
assert.equal(dedupeResult.updatedAllSections[0].sessions.length, 2, 'Catalog section must now have both Monday and Wednesday meetings');
console.log('✓ Test 6 Passed: deduplicateSections recognizes formatting variants and updates catalog losslessly.');

// --- Test 7: Cross-course boundaries strictly enforced ---
console.log('Running Test 7: Cross-course boundaries strictly enforced');
const crossCourseSections: Section[] = [
  {
    id: 'c1',
    name: 'Calculus I',
    courseCode: 'MATH101',
    sectionCode: '01',
    credits: 4,
    sessions: [{ id: 'm1', day: 'MON', start: '08:00', end: '09:00', type: 'Lecture' }],
  },
  {
    id: 'c2',
    name: 'General Physics I',
    courseCode: 'PHYS201',
    sectionCode: '01',
    credits: 4,
    sessions: [{ id: 'm2', day: 'MON', start: '08:00', end: '09:00', type: 'Lecture' }],
  },
];
const reconciledCross = reconcileOCRSections(crossCourseSections);
assert.equal(reconciledCross.length, 2, 'Sections with same section code in different courses must NEVER merge');
console.log('✓ Test 7 Passed: Cross-course sections never merge.');

// --- Test 8: Missing section code records preserved without fabrication ---
console.log('Running Test 8: Missing section code records preserved without fabrication');
const missingSectionRecord: Section[] = [
  {
    id: 'm1',
    name: 'Introduction to Philosophy',
    courseCode: 'PHIL101',
    sectionCodeMissing: true,
    credits: null,
    sessions: [{ id: 's1', day: 'THU', start: '14:00', end: '16:00', type: 'Seminar' }],
  },
];
const reconciledMissing = reconcileOCRSections(missingSectionRecord);
assert.equal(reconciledMissing.length, 1);
assert.equal(reconciledMissing[0].sectionCodeMissing, true);
assert.equal(reconciledMissing[0].needsReview, true);
assert.ok(reconciledMissing[0].reviewReasons?.includes('section_code_missing'));
console.log('✓ Test 8 Passed: Missing section codes preserved without fabrication.');

console.log('================================================================');
console.log('ALL DETERMINISTIC CANONICAL IDENTITY REGRESSION TESTS PASSED 100%!');
console.log('================================================================');
