import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');

const root = path.resolve(import.meta.dirname, '..');
const step = fs.readFileSync(path.join(root, 'src/components/StepAddCourses.tsx'), 'utf8');
const model = fs.readFileSync(path.join(root, 'src/features/courseBuilder/model.ts'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'src/utils/imageFileAnalysis.ts'), 'utf8');

const checks = [];
const ok = (condition, label) => { checks.push([condition, label]); if (!condition) console.error(`FAIL: ${label}`); };

ok(step.includes('sha256File') && step.includes('visualFingerprint'), 'content identity helpers are wired into upload selection');
ok(step.includes('MAX_SCREENSHOTS_PER_BATCH = 30'), 'client screenshot batch is bounded');
ok(step.includes('existingFiles.length + validNewFiles.length >= MAX_SCREENSHOTS_PER_BATCH'), 'batch cap applies across previously selected screenshots');
ok(step.includes('is an exact duplicate of a screenshot already selected'), 'same content is rejected as an exact duplicate');
ok(step.includes('is an exact duplicate of a screenshot already selected'), 'exact content duplicates are rejected');
ok(step.includes('looks very similar to another screenshot') && step.includes('Both were kept'), 'near duplicates warn without dropping potentially complementary evidence');
ok(step.includes('setPendingParsedSections(null)') && step.includes('safeStorage.removeItem(STORAGE_KEY_PENDING_REVIEW)'), 'adding a new screenshot invalidates stale OCR review state');
ok(step.includes('handleProcessScreenshotsRef.current(nextFiles)'), 'adding more screenshots reprocesses the complete evidence set');
ok(step.includes('batchGeneration !== ocrBatchGenerationRef.current'), 'stale OCR responses are blocked after reset/cancel');
ok(step.includes("CLIENT_TIMEOUT"), 'client OCR request has a hard timeout');
ok(step.includes('WorkflowStatus') && step.includes('ocrError'), 'general OCR errors are visibly rendered');
ok(step.includes('responsive-file-status is-error') || css.includes('.responsive-file-status.is-error'), 'per-file OCR failure status is red/bold');
ok(css.includes('overflow-wrap: anywhere') && css.includes('white-space: normal'), 'long filenames remain readable instead of being hard-truncated');
ok(step.includes('is-drag-active') && step.includes('onDragEnter'), 'drag-and-drop has visible active state');
ok(step.includes('setIsDragActive(false)') && step.includes('dispatchWorkflow({ type: \'RESET\' })'), 'clear-all resets visual and workflow state');
ok(model.includes('contentHash?: string | null;') && model.includes('visualFingerprint?: string | null;'), 'uploaded file model stores identity metadata');
ok(server.includes('const MAX_TOTAL_IMAGES_BYTES = config.maxTotalImagesBytes') && server.includes('const MAX_IMAGES_PER_REQUEST = config.maxImagesPerRequest'), 'server aggregate/image count limits are sourced from shared config');
ok(server.includes(`const MAX_RAW_PAYLOAD_BYTES = config.maxRawPayloadBytes`) && server.includes('const JSON_BODY_PARSER_LIMIT') && server.includes('express.json({ limit: JSON_BODY_PARSER_LIMIT })'), 'JSON parser ceiling matches transport guard');
ok(!server.includes('gemini-3.1-flash-lite-preview'), 'shutdown Gemini model is removed from OCR fallback registry');
ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'upload animation respects reduced motion');

const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'imageFileAnalysis.ts',
}).outputText;
const module = { exports: {} };
vm.runInNewContext(`const module = globalThis.__module; const exports = module.exports; ${transpiled};`, {
  __module: module,
  crypto,
});
const { fingerprintDistance } = module.exports;
ok(fingerprintDistance('0000', '0000') === 0, 'fingerprint distance returns zero for identical fingerprints');
ok(fingerprintDistance('0000', '0011') === 2, 'fingerprint distance counts differing bits');
ok(fingerprintDistance('000', '00') === null, 'fingerprint distance rejects incompatible fingerprints');

const failures = checks.filter(([condition]) => !condition).length;
console.log(`Screenshot upload audit implementation checks: ${checks.length - failures}/${checks.length} passed.`);
process.exitCode = failures ? 1 : 0;
