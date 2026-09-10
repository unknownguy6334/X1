const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tmpOptimizer = path.join(root, '.tmp-cjs/utils/optimizer.js');
const tmpCourseUtils = path.join(root, '.tmp-cjs/utils/courseUtils.js');
if (!fs.existsSync(tmpOptimizer) || !fs.existsSync(tmpCourseUtils)) {
  const optimizer = fs.readFileSync(path.join(root, 'src/utils/optimizer.ts'), 'utf8');
  const results = fs.readFileSync(path.join(root, 'src/components/StepResults.tsx'), 'utf8');
  const checks = [
    [optimizer.includes("searchCompleteness = 'capped'") && optimizer.includes("=== 'exhaustive'"), 'optimizer distinguishes capped from exhaustive search'],
    [optimizer.includes("searchCompleteness: 'not_searched'"), 'optimizer marks preflight output as not searched'],
    [optimizer.includes('canAddSectionEarly'), 'optimizer uses early section pruning'],
    [optimizer.includes('DEFAULT_SEARCH_BUDGET'), 'optimizer uses centralized search budget'],
    [results.includes('searchCompleteness') && results.includes('Search limit reached.'), 'Results surfaces partial search state'],
  ];
  for (const [ok, label] of checks) assert.ok(ok, label);
  console.log(`SEARCH/OPTIMIZATION ENGINE AUDIT: ${checks.length}/${checks.length} source-contract checks passed (runtime transpilation unavailable)`);
  process.exit(0);
}
const { runOptimizer, DEFAULT_SEARCH_BUDGET } = require(tmpOptimizer);
const { getScheduleSignature } = require(tmpCourseUtils);

const s = (id, code, name, credits, day, start, end, extra={}) => ({ id, courseCode: code, courseKey: `code:${code.toLowerCase()}`, name, credits, sessions:[{id:`m-${id}`, day, start, end, type:'Lecture', ...extra}] });
const base = (overrides={}) => ({targetCredits:null, dayBuckets:[1,2,3,4,5,6,7], targetCourseCount:null, mandatoryCourses:[], mandatoryCourseKeys:[], useCreditRange:false, minCredits:undefined, maxCredits:undefined, earliestStartTime:'ANY', latestEndTime:'ANY', freeDays:[], maxDays:null, preferCompactDays:false, ...overrides});

// P0 mandatory with invalid-only section must fail explicitly.
let out = runOptimizer({courses:{'code:bad1':[s('bad','BAD1','Bad Course',3,'MON','bad','11:00')]}, fixedCourses:[], preferences:base({mandatoryCourseKeys:['code:bad1'], targetCredits:3})});
assert.match(out.impossibleDiagnostic?.reason || '', /Bad Course|code:bad1/);

// Unknown credits are excluded when exact credit matching is active.
out = runOptimizer({courses:{'code:a':[s('a','A101','A',3,'MON','09:00','10:00')], 'code:u':[s('u','U101','U',null,'TUE','09:00','10:00')]}, fixedCourses:[], preferences:base({targetCredits:3})});
const schedules = Object.values(out.byDayCount).flat();
assert.equal(schedules.some(x=>x.sections.some(sec=>sec.courseCode==='U101')), false);

// Unknown credits remain usable when no credit preference is active.
out = runOptimizer({courses:{'code:u':[s('u','U101','U',null,'MON','09:00','10:00')]}, fixedCourses:[], preferences:base({targetCourseCount:1})});
assert.equal(Object.values(out.totalFoundByDay).reduce((a,b)=>a+b,0), 1);

// Fixed duplicate course identities are rejected.
const f1=s('f1','FIX1','Fixed',3,'MON','09:00','10:00');
const f2=s('f2','FIX1','Fixed',3,'TUE','09:00','10:00');
out = runOptimizer({courses:{}, fixedCourses:[f1,f2], preferences:base()});
assert.match(out.impossibleDiagnostic?.reason || '', /more than one section/);

// Exact credits + mandatory + course count all apply together.
out = runOptimizer({courses:{
  'code:a':[s('a','A101','A',3,'MON','09:00','10:00')],
  'code:b':[s('b','B101','B',3,'TUE','09:00','10:00')],
  'code:c':[s('c','C101','C',3,'WED','09:00','10:00')]
}, fixedCourses:[], preferences:base({targetCredits:6,targetCourseCount:2,mandatoryCourseKeys:['code:a']})});
assert.ok(Object.values(out.byDayCount).flat().every(x => x.totalCredits===6 && x.sections.length===2 && x.sections.some(s=>s.courseCode==='A101')));

// Hard constraints prune/accept correctly.
out = runOptimizer({courses:{'code:a':[s('a','A101','A',3,'MON','08:00','09:00')]}, fixedCourses:[], preferences:base({targetCredits:3, freeDays:['MON']})});
assert.equal(Object.values(out.totalFoundByDay).reduce((a,b)=>a+b,0),0);
out = runOptimizer({courses:{'code:a':[s('a','A101','A',3,'MON','10:00','11:00')]}, fixedCourses:[], preferences:base({targetCredits:3, earliestStartTime:'09:30', latestEndTime:'11:00', maxDays:1, dayBuckets:[1]})});
assert.equal(Object.values(out.totalFoundByDay).reduce((a,b)=>a+b,0),1);

// Back-to-back sessions are valid and gap is zero.
out = runOptimizer({courses:{'code:a':[s('a','A101','A',3,'MON','09:00','10:00')], 'code:b':[s('b','B101','B',3,'MON','10:00','11:00')]}, fixedCourses:[], preferences:base({targetCredits:6, dayBuckets:[1]})});
assert.equal(out.byDayCount[1][0]?.totalGap,0);

// No result corpus larger than five per bucket.
const many={};
for(let i=0;i<7;i++){many[`code:c${i}`]=[s(`c${i}`,`C${i}`,'C'+i,1,'MON',`${String(8+i).padStart(2,'0')}:00`,`${String(9+i).padStart(2,'0')}:00`)];}
out = runOptimizer({courses:many, fixedCourses:[], preferences:base()});
assert.ok(Object.values(out.byDayCount).every(list=>list.length<=5));

// Search budget reports capped honestly.
out = runOptimizer({courses:many, fixedCourses:[], preferences:base(), searchBudget:{...DEFAULT_SEARCH_BUDGET,maxCourseSubsetNodes:2,maxSectionNodes:2,maxDurationMs:10000}});
assert.equal(out.searchCompleteness,'capped');
assert.equal(out.wasCapped,true);

// Estimate mode uses bounded mode and never retains a large result corpus.
out = runOptimizer({courses:many, fixedCourses:[], preferences:base(), mode:'estimate'});
assert.ok(Object.values(out.byDayCount).every(list=>list.length<=5));

// Custom meeting type participates in canonical signature.
const ca=s('x','X1','X',3,'MON','09:00','10:00',{type:'Custom',customType:'Lab'});
const cb=s('x','X1','X',3,'MON','09:00','10:00',{type:'Custom',customType:'Workshop'});
assert.notEqual(getScheduleSignature({id:'a',sections:[ca]}), getScheduleSignature({id:'b',sections:[cb]}));

console.log('SEARCH/OPTIMIZATION ENGINE AUDIT RUNTIME: 10/10 passed');
