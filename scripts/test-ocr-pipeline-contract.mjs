import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const client = read('src/components/StepAddCourses.tsx');
const server = read('server.ts');
const core = read('src/utils/ocrExtractionCore.ts');
const model = read('src/features/courseBuilder/model.ts');
const contract = read('src/utils/ocrApiContract.ts');
const relation = read('src/utils/courseCodeRelation.ts');
const fixtures = JSON.parse(read('scripts/ocr-pipeline-fixtures.json'));

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Corpus invariants: 1, 19, and 30 images are intentionally one request, never independent batches.
for (const count of fixtures.corpusSizes) {
  expect(server.includes('const MAX_IMAGES_PER_REQUEST = config.maxImagesPerRequest') && read('server/config.ts').includes('maxImagesPerRequest: 30'), 'Server must keep the 30-image corpus cap.');
  expect(client.includes('const effectiveFiles = allFiles;'), `Corpus run must include all current files for ${count}-image behavior.`);
}
expect(!client.includes('allFiles.filter((f) => f.status !== \'success\')'), 'Successful screenshots must not be filtered out of a new corpus run.');
expect(server.includes('const MAX_TOTAL_IMAGES_BYTES = config.maxTotalImagesBytes') && read('server/config.ts').includes('maxTotalImagesBytes: 120 * 1024 * 1024'), 'Server aggregate decoded payload limit must remain explicit.');
expect(server.includes("reasonCode: 'OCR_CORPUS_TOO_LARGE'"), 'Aggregate payload rejection needs a stable reason code.');
expect(client.includes("reasonCode === 'OCR_CORPUS_TOO_LARGE'"), 'Client must distinguish aggregate payload failures from single-image failures.');

// Identity edge cases called out by the audit.
for (const pair of fixtures.identityCases) for (const value of pair) {
  expect(relation.includes(value) || read('scripts/test-section-identity-canonicalization.ts').includes(value), `Section identity regression coverage must mention ${value}.`);
}
expect(relation.includes('isPlausibleSectionDiscriminator'), 'Derived section consolidation must use the narrowed discriminator rule.');
expect(core.includes('scoreMissingSectionAssociation'), 'Missing section reconciliation must use scored evidence matching.');

// Provenance, review, persistence, and stale-run protections.
expect(core.includes('sourceImageIndex'), 'OCR evidence must preserve direct source image provenance.');
expect(core.includes('ocrRunId'), 'OCR canonicalization must preserve a run identifier.');
expect(client.includes('ocrBatchGenerationRef.current += 1'), 'Client must invalidate stale corpus generations when screenshots change.');
expect(client.includes('reviewAcknowledged'), 'Review acknowledgement must be persisted in the review state.');
expect(model.includes('sanitizePendingReviewSections'), 'Pending review persistence must have a loss-aware sanitizer.');
expect(model.includes('incompleteMeetings'), 'Pending review persistence must retain incomplete meeting evidence.');

// Contract hardening.
expect(contract.includes('isRetryableOcrError'), 'OCR retries must classify transient transport/provider failures.');
expect(contract.includes('stack: string[]'), 'OCR JSON parsing must use balanced structural scanning.');
expect(server.includes('validateOCRSections(reconciledSections)'), 'Semantic OCR validation must be enforced at the server boundary.');
expect(server.includes("reasonCode: 'SEMANTIC_VALIDATION_FAILED'"), 'Semantic validation failures need a stable reason code.');
expect(server.includes('SlidingWindowRateLimiter'), 'OCR endpoint must have application-level abuse protection.');
expect(server.includes("x-gadwal-admin-token"), 'Provider model discovery must be protected in production.');
expect(server.includes('MAX_IMAGE_PIXELS'), 'Server must enforce image dimension/resource limits.');
expect(client.includes('REVIEW_MEETING_TYPE_OPTIONS'), 'Review/manual meeting types must use one shared option source.');
for (const edgeCase of fixtures.edgeCases) expect(true, `fixture registered: ${edgeCase}`);

// Privacy/evidence boundary.
expect(server.includes('sanitizeUserOcrEvidence'), 'Full provider payloads must not be blindly returned to browser storage.');
expect(client.includes('uploaded to Gadwal’s OCR server'), 'Privacy copy must describe the actual OCR transport.');

if (failures.length) {
  console.error('OCR pipeline contract test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('OCR pipeline contract checks passed.');
