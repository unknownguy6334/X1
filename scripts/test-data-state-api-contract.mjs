import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(f)=>fs.readFileSync(f,'utf8');
const root=new URL('..', import.meta.url).pathname;
const app=read(root+'src/App.tsx');
const persistence=read(root+'src/app/persistence.ts');
const persistenceValidation=read(root+'src/utils/persistenceValidation.ts');
const service=read(root+'src/app/workflowPersistence.ts');
const child=read(root+'src/components/StepAddCourses.tsx');
const api=read(root+'src/utils/ocrApiContract.ts');
const server=read(root+'server.ts');
const ocr=read(root+'src/utils/ocrExtractionCore.ts');
const types=read(root+'src/types.ts');
const checks=[
  [persistence.includes("SUPPORTED_SCHEMA_VERSIONS") && persistence.includes("readSnapshot"),'future storage schemas are not hydrated'],
  [persistence.includes("CURRENT_RESULT_CONTRACT_VERSION") && persistence.includes("signatureStatus") && persistence.includes("CURRENT_RESULT_CONTRACT_VERSION"),'persisted result contract status is validated'],
  [persistence.includes('const sanitizedSections: Section[] = []') && persistence.includes('if (one.length !== 1) { valid = false; break; }'),'stored schedules are sanitized atomically'],
  [persistenceValidation.includes('courseKey: getCourseIdentityKey'),'persisted courseKey is canonical'],
  [ocr.includes('return getCourseIdentityKey(code || extracted, name);') && !ocr.includes('const normName = courseName?.trim()'),'OCR and app use one course identity implementation'],
  [child.includes('validateOcrApiResponse(data)'),'client validates OCR response at network boundary'],
  [api.includes('export interface OcrApiResponse') && api.includes('validateOcrApiResponse'),'runtime OCR response contract exists'],
  [!child.includes('for (let attempt = 0; attempt < 2; attempt++)') && child.includes("fetch('/api/extract-schedule'"),'frontend has one OCR transport attempt per request'],
  [api.includes("CLIENT_ABORTED')") && api.includes('options.parentSignal?.removeEventListener'),'provider retry observes cancellation'],
  [service.includes('WORKFLOW_DRAFT_KEYS') && service.includes('clearAllWorkflowDrafts'),'workflow drafts have a single persistence owner'],
  [child.includes('savePendingReview(') && child.includes('saveManualForms('),'feature writes use centralized persistence service'],
  [app.includes('clearAllPersistedAppData();'),'reset uses centralized persistence clearing'],
  [server.includes('ALLOWED_TELEMETRY') && server.includes('telemetryRateLimiter'),'telemetry has abuse controls'],
  [server.includes('normalizeMeetingType(session?.type)'),'server preserves canonical custom meeting type semantics'],
  [ocr.includes("type: resolvedType") && ocr.includes('meetingType.customType'),'OCR preserves custom meeting labels'],
  [types.includes('workflowGenerationId?: string;'),'workflow generation identifier exists'],
  [app.includes('workflowGenerationRef') && app.includes('resultContractVersion'),'optimizer generation metadata is persisted'],
  [child.includes('workflowGenerationId })') || child.includes('workflowGenerationId,'),'OCR requests carry workflow generation identity'],
  [server.includes('workflowGenerationId = typeof req.body?.workflowGenerationId'),'server receives workflow generation identity'],
  [child.includes('going back online never starts an expensive OCR run') && !child.includes('handleRetryFailed();\n        }, backoffMs'),'offline recovery is explicit rather than automatic'],
  [api.includes("export function parseApiErrorEnvelope") && child.includes('parseApiErrorEnvelope(data)'),'API errors use stable reason codes'],
  [service.includes("source: 'local'") === false && service.includes('readLatestPersisted'),'draft reads are centralized and durable-first via shared reader'],
  [app.includes('reconcileCourseBuilderWorkflow'),'workflow phase invariants are reconciled'],
  [persistence.includes("CURRENT_RESULT_CONTRACT_VERSION = 'v3'"),'result generation contract version is explicit'],
  [server.includes('retryable: [408, 429, 500, 502, 503, 504].includes(status)') && server.includes('errorId:'),'server exposes retryability in OCR error envelope'],
];
for (const [ok,msg] of checks) assert.ok(ok,msg);
console.log(`DATA/STATE/API CONTRACT: ${checks.length}/${checks.length} passed`);
