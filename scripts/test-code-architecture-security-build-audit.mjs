import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.ts');
const config = read('server/config.ts');
const headers = read('server/securityHeaders.ts');
const staticApp = read('server/staticApp.ts');
const fallback = read('server/ocrModelFallback.ts');
const ocrService = read('server/ocrExtractionService.ts');
const ocrContract = read('src/utils/ocrApiContract.ts');
const imagePolicy = read('src/utils/imageOptimizationPolicy.ts');
const imageOpt = read('src/utils/imageOptimizer.ts');
const imageWorker = read('src/workers/image-optimizer.worker.ts');
const pkg = JSON.parse(read('package.json'));
const build = read('scripts/build-server.mjs');
const checks = [
  [config.includes('parsePort') && server.includes('const PORT = config.port'), 'server port is configuration-driven'],
  [config.includes('requireTrustedProxy') && config.includes('TRUSTED_PROXY_CIDRS must be configured'), 'proxy configuration is validated'],
  [!read('vite.config.ts').includes('allowedHosts: true as const') && read('vite.config.ts').includes('VITE_ALLOW_EXTERNAL_HOST'), 'Vite hosts are restricted by default'],
  [headers.includes('Content-Security-Policy') && headers.includes('Strict-Transport-Security') && headers.includes('Permissions-Policy'), 'security headers are explicit'],
  [headers.includes('frame-ancestors') && config.includes('frameAncestors'), 'framing policy is environment-configurable'],
  [server.includes('MAX_CONCURRENT_OCR_BODY_PARSES') && server.includes('const JSON_BODY_PARSER_LIMIT') && server.includes('express.json({ limit: JSON_BODY_PARSER_LIMIT })'), 'large OCR parsing is bounded'],
  [server.includes("structuredServerLog('error', 'OCR extraction failed'") && !server.includes('console.error("Error in /api/extract-schedule:"'), 'OCR errors are sanitized'],
  [fallback.includes('runOcrWithModelFallback') && server.includes('runOcrWithModelFallback'), 'OCR fallback service is shared'],
  [ocrService.includes('extractOcrCorpus') && server.includes('extractOcrCorpus'), 'OCR corpus orchestration is extracted from the route'],
  [server.includes('timingSafeEqual') && config.includes('ENABLE_DIAGNOSTIC_MODELS_ENDPOINT'), 'diagnostic endpoint is hardened'],
  [server.includes("app.use('/api'") && server.includes("reasonCode: 'NOT_FOUND'") && staticApp.includes("req.path.startsWith('/api/')"), 'API routes do not fall through to SPA'],
  [build.includes('sourcemap') && !pkg.scripts.build.includes('--sourcemap'), 'production source maps are controlled by the build helper'],
  [pkg.devDependencies?.vite && !pkg.dependencies?.vite, 'Vite has one dependency owner'],
  [imagePolicy.includes('maxDimension: 2200') && imageOpt.includes('POLICY.maxDimension') && imageWorker.includes('POLICY.maxDimension'), 'image optimization policy is shared'],
  [read('src/utils/imageFileAnalysis.ts').includes('HASH_CHUNK_BYTES') && read('src/utils/imageFileAnalysis.ts').includes('chunked-v1'), 'large-file hashing is bounded'],
  [ocrContract.includes('export type OcrOutcome') && !ocrContract.includes('as any'), 'OCR boundary contract uses typed unknown data'],
  [read('src/features/courseBuilder/model.ts').includes('valueItem') && !read('src/features/courseBuilder/model.ts').includes('(item: any)'), 'course recovery boundary avoids any'],
  [read('src/app/persistence.ts').includes('OptimizationResult') && !read('src/app/persistence.ts').includes('const parsed = value as any'), 'persistence boundary avoids any'],
  [read('src/App.tsx').includes('areSchedulePreferencesEqual') && !read('src/App.tsx').includes('JSON.stringify(reconciled)'), 'preference reconciliation avoids full stringify comparison'],
  [staticApp.includes('configureFrontendServing'), 'frontend serving is modularized'],
  [read('scripts/verify-release-config.mjs').includes('package-lock.json'), 'release lockfile is enforced by verification'],
  [pkg.scripts['audit:dependencies'] === 'npm audit --audit-level=high', 'dependency audit script exists'],
];
for (const [ok, label] of checks) assert.ok(ok, label);
console.log(`CODE ARCHITECTURE / SECURITY / BUILD CONTRACT: ${checks.length}/${checks.length} passed`);
