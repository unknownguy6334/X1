import fs from 'node:fs';
const failures=[]; const pass=[];
const read=(f)=>fs.readFileSync(f,'utf8');
const app=read('src/App.tsx'); const res=read('src/components/StepResults.tsx'); const step=read('src/components/StepAddCourses.tsx'); const prefs=read('src/utils/preferenceValidation.ts'); const popup=read('src/hooks/usePopupInteractions.ts'); const modal=read('src/hooks/useModalAccessibility.ts'); const ocr=read('src/utils/ocrExtractionCore.ts'); const pers=read('src/app/persistence.ts'); const worker=read('src/utils/optimizerWorkerClient.ts'); const id=read('src/domain/identity.ts'); const time=read('src/domain/time.ts'); const queue=read('src/utils/persistenceQueue.ts');
const checks=[
  [app.includes('workflowGenerationRef.current = createGenerationId'), 'workflow generation rotates on reset'],
  [app.includes('if (!canNavigateTo(step)) return false;'), 'navigation guard enforced'],
  [app.includes("optimizerOutput?.signatureStatus === 'verified'"), 'results route requires verified output'],
  [pers.includes('migrateSnapshot'), 'persistence migration centralized'],
  [pers.includes('SUPPORTED_RESULT_CONTRACT_VERSIONS'), 'result contract version validated'],
  [res.includes('sectionsSnapshot'), 'results use generated snapshots'],
  [worker.includes('cancelPreviousOwner'), 'optimizer owner cancellation exists'],
  [id.includes("normalize('NFKC')"), 'identity normalization is canonical'],
  [time.includes('parseTimeToMinutes'), 'canonical scheduling time parser exists'],
  [queue.includes('lastPayload'), 'storage queue deduplicates writes'],
  [!app.match(/\(insertedSections as any\)/), 'no ad-hoc AddSectionsResult array mutation'],
  [!read('src/domain/index.ts').includes("export * from './events';\nexport * from './events';"), 'domain exports are unique'],
  [(() => { const dep=app.indexOf('}, [optimizerOutput]'); const decl=app.indexOf('const currentStep'); return dep < 0 || decl < 0 || dep > decl; })(), 'optimizer persistence dependency is not before currentStep declaration'],
  [step.includes('await sha256File(file)') && !step.includes('fileSignature(f.file) === fileSignature(file)'), 'content-hash exact screenshot deduplication'],
  [step.includes('OCR_PREPARATION_CACHE'), 'per-image OCR preparation cache'],
  [prefs.includes('TARGET_COURSE_COUNT_MAX = 40'), 'central preference course-count limit'],
  [popup.includes("event.key === 'Escape'") && popup.includes("event.key === 'Enter'"), 'role-aware popup keyboard behavior'],
  [modal.includes('requestAnimationFrame') && modal.includes('getTopOverlay()?.id !== overlayId'), 'overlay-aware modal focus scheduling'],
  [ocr.includes('Array.isArray(section?.sessions)') && ocr.includes('source_record_index'), 'legacy OCR meeting provenance retention'],
];
for(const [ok,label] of checks) (ok?pass:failures).push(label);
for(const p of pass) console.log('PASS',p); for(const f of failures) console.error('FAIL',f);
if(failures.length){process.exit(1)} console.log(`FINAL INTEGRATION: ${pass.length}/${checks.length} checks passed`);
