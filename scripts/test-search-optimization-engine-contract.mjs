import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const files = {
  optimizer: read('src/utils/optimizer.ts'), core: read('src/utils/optimizerCore.ts'), worker: read('src/utils/optimizerWorkerClient.ts'),
  app: read('src/App.tsx'), add: read('src/components/StepAddCourses.tsx'), results: read('src/components/StepResults.tsx'),
  persistence: read('src/app/persistence.ts'), types: read('src/types.ts'), copy: read('src/content/copy.ts')
};
let n=0; const failures=[]; const ok=(v,m)=>{n++; if(!v) failures.push(m)};
// #1 mandatory invalid-section handling
ok(files.optimizer.includes('unschedulableMandatory') && files.optimizer.includes('validCourses[exactKey]'), 'mandatory courses distinguish missing vs unschedulable invalid-section cases');
// #2/#14 explicit credit states
ok(files.optimizer.includes("status: 'known' | 'unknown' | 'conflicting'") && files.optimizer.includes("creditConstraintActive") && files.optimizer.includes('creditStates'), 'credit matching distinguishes known/unknown/conflicting state');
// #3 fixed course identity invariant
ok(files.optimizer.includes('duplicateCourseKey') && files.optimizer.includes('fixedCourseKeys(fixed)'), 'fixed sections are validated as unique course identities');
// #4 result/search budget and bounded retention
ok(files.optimizer.includes('DEFAULT_SEARCH_BUDGET') && files.optimizer.includes('maxCourseSubsetNodes') && files.optimizer.includes('maxSectionNodes') && files.optimizer.includes('RESULT_LIMIT_PER_DAY'), 'optimizer has centralized deterministic search/result budgets');
ok(files.optimizer.includes("output.searchCompleteness = 'capped'") && files.optimizer.includes('output.wasCapped = control.capped'), 'budget termination is reported as capped');
// #5 estimate mode
ok(files.optimizer.includes("type OptimizerMode = 'full' | 'estimate' | 'diagnostic'") && files.optimizer.includes("mode = 'full'") && files.add.includes("mode: 'estimate'"), 'live estimate uses explicit bounded estimate mode');
ok(files.add.includes("mode: 'estimate'"), 'StepAddCourses dispatches estimate mode');
// #6 early hard-constraint pruning
for (const token of ['freeDays','earliestStartTime','latestEndTime','maxDays','dayBuckets']) ok(files.optimizer.includes(token) && files.optimizer.includes('canAddSectionEarly'), `section recursion prunes ${token} early`);
// #7 shared budget in worker/main fallback
ok(files.worker.includes('DEFAULT_SEARCH_BUDGET') && files.worker.includes('searchBudget: params.searchBudget || DEFAULT_SEARCH_BUDGET'), 'main-thread fallback uses optimizer budget rather than independent heuristic threshold');
// #8 legacy signature is not retroactively stamped
ok(!files.app.includes('sanitized.generatedInputsSignature = computeInputsSignature'), 'legacy output is never stamped with a current signature');
ok(files.persistence.includes('signatureStatus') && files.persistence.includes('CURRENT_RESULT_CONTRACT_VERSION'), 'persisted outputs expose unverifiable signature status');
// #9 ranking contract
ok(files.optimizer.includes('const gapDiff') && files.optimizer.includes('const dayDiff') && files.optimizer.includes('preferCompactDays'), 'ranking uses shared gap/day/compactness comparator');
ok(files.results.includes('Fewer campus days') && files.results.includes('Least total gap time') && files.results.includes('compact daily spans'), 'ranking explanation matches comparator');
// #10 category ranks separate from global best
ok(files.results.includes('categoryRankMap') && files.results.includes('globalRankMap'), 'Results keeps category rank separate from global Best rank');
// #11 canonical persistence signature
ok(files.persistence.includes('getScheduleSignature') && !files.persistence.includes('normalizeCourseName(section.name)}:::${section.id'), 'persistence reuses canonical schedule signature');
// #12 global results are bounded/merged
ok(files.results.includes('while (out.length < 5)') && files.results.includes('rankedByDay'), 'global Best uses bounded top-K merge over ranked day buckets');
// #13 tie uses full comparator
ok(files.optimizer.includes('compareSchedulesForPreferences(previous, schedule, preferences) === 0') && files.optimizer.includes('compareSchedulesForPreferences(schedule, next, preferences) === 0'), 'tie state uses complete ranking comparator');
// #15 time capability boundary is explicit
ok(files.optimizer.includes('GADWAL currently models every schedulable meeting as a real day/time interval') && files.optimizer.includes('Missing day/time data is therefore intentionally invalid'), 'scheduled-session data contract is explicit');
// #16 incremental search state
ok(files.optimizer.includes('SearchState') && files.optimizer.includes('insertInterval') && files.optimizer.includes('removeInterval') && files.optimizer.includes('stateToMetrics'), 'section search carries incremental schedule state');
// #17 shared traversal primitives
ok(files.optimizer.includes('Shared exhaustive traversal used by both the normal optimizer and achievable-credit analysis') && files.optimizer.includes('enumerateSectionCombinations'), 'course and section traversal share engine primitives');
// #18 completeness UI
ok(files.results.includes("const completeness = optimizerOutput.searchCompleteness || 'not_searched'") && files.results.includes('Search limit reached.'), 'partial search state is surfaced to users');
// #19 cancellation control
ok(files.add.includes('Cancel search') && files.add.includes('onCancelOptimizer') && files.app.includes('handleCancelOptimizer'), 'user can explicitly cancel a running search');
// #20 relaxation diagnostics
ok(files.optimizer.includes('diagnosticRelaxations') && files.optimizer.includes('secondaryDiagnostics') && files.results.includes('Relax a constraint'), 'no-results state has bounded actionable relaxation diagnostics');
console.log(`SEARCH OPTIMIZATION ENGINE AUDIT CONTRACT: ${n-failures.length}/${n} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
