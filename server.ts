import dotenv from "dotenv";
import { recordServerMetric, hashIp, structuredServerLog } from './server/observability';
import { loadServerConfig, setServerConfig } from './server/config';
import { serializeServerError } from './server/errors';
import { SlidingWindowRateLimiter } from './server/rateLimiter';

import { runOcrWithModelFallback } from './server/ocrModelFallback';
import { extractOcrCorpus } from './server/ocrExtractionService';
import { configureFrontendServing } from './server/staticApp';
import { registerHealthRoutes } from './server/healthRoutes';
import { securityHeaders } from './server/securityHeaders';
import { detectImageDimensions } from './server/imageValidation';
dotenv.config({ path: ".env.local" });
dotenv.config();
import express from "express";
import http from "http";
import { randomUUID } from "crypto";
import { GoogleGenAI } from "@google/genai";
import { parseOcrJsonPayload, validateOcrModelShape, validateOcrApiResponse } from "./src/utils/ocrApiContract";
import { OCR_END_TO_END_BUDGET_MS } from './src/utils/ocrTimeout';
import type { Section } from "./src/types";
import { normalizeMeetingType } from './src/utils/meetingTypes';
import { adaptLegacyOcrPayload, canonicalToAppSections, modelOutputToCanonical, reconcileOCRSections, validateOCRSections } from "./src/utils/ocrExtractionCore";

async function startServer() {
  const app = express();
  const config = loadServerConfig();
  setServerConfig(config);
  const PORT = config.port;

  app.disable("x-powered-by");
  app.use(securityHeaders);

  // Trust only explicitly configured ingress proxies.
  if (config.trustedProxyCidrs.length > 0) {
    app.set('trust proxy', config.trustedProxyCidrs);
  } else {
    app.set('trust proxy', false);
  }

  // Size limits for a SINGLE logical OCR request. The OCR UI intentionally sends the
  // complete selected screenshot set in one request so Gemini can see all evidence together.
  // These are transport safeguards, not OCR batching limits.
  const MAX_SINGLE_IMAGE_BYTES = config.maxSingleImageBytes;
  const MAX_TOTAL_IMAGES_BYTES = config.maxTotalImagesBytes;
  const MAX_RAW_PAYLOAD_BYTES = config.maxRawPayloadBytes;
  const MAX_IMAGES_PER_REQUEST = config.maxImagesPerRequest;
  const MAX_GLOBAL_CONCURRENT_WORK = config.maxGlobalConcurrentWork;
  const MAX_IMAGE_DIMENSION = config.maxImageDimension;
  const MAX_IMAGE_PIXELS = config.maxImagePixels;

  const isValidBase64 = (value: string): boolean => {
    if (!value || typeof value !== "string") return false;
    const clean = value.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    if (clean.length < 8 || clean.length % 4 !== 0) return false;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return false;
    const paddingIndex = clean.indexOf("=");
    if (paddingIndex >= 0 && paddingIndex < clean.length - 2) return false;
    return true;
  };

  // Detect true image format from magic bytes and validate
  const detectOrValidateImageFormat = (base64Str: string, declaredMime: string): { valid: boolean; detectedMime: string } => {
    try {
      const clean = base64Str.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
      const header = Buffer.from(clean.slice(0, 128), "base64");
      const bytes = [...header];
      if (bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") {
        return { valid: true, detectedMime: "image/png" };
      }
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return { valid: true, detectedMime: "image/jpeg" };
      }
      if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
        return { valid: true, detectedMime: "image/webp" };
      }
    } catch {}
    return { valid: false, detectedMime: declaredMime };
  };


  const getDecodedBase64ByteLength = (base64Str: string): number => {
    if (!base64Str || typeof base64Str !== "string") return 0;
    try {
      return Buffer.byteLength(base64Str, "base64");
    } catch {
      const clean = base64Str.trim();
      let padding = 0;
      if (clean.endsWith("==")) padding = 2;
      else if (clean.endsWith("=")) padding = 1;
      return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
    }
  };

  const getImageDimensions = (base64Str: string, mime: string): { width: number; height: number } | null => detectImageDimensions(base64Str, mime, getDecodedBase64ByteLength(base64Str));

  const ocrRateLimiter = new SlidingWindowRateLimiter(config.ocrRateLimitPerMinute, config.ocrRateLimitWindowMs);

  // Early rejection of oversized requests based on Content-Length header before buffering stream
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const rawContentLength = req.headers["content-length"];
    if (rawContentLength) {
      const parsedLength = parseInt(rawContentLength, 10);
      if (!Number.isNaN(parsedLength) && parsedLength > MAX_RAW_PAYLOAD_BYTES) {
        return res.status(413).json({
          error: `Request body exceeds the ${Math.round(MAX_RAW_PAYLOAD_BYTES / (1024 * 1024))} MB server payload limit (declared: ${(parsedLength / (1024 * 1024)).toFixed(1)} MB).`,
        });
      }
    }
    next();
  });

  // Bound concurrent large OCR JSON parsing as well as downstream model work. The body parser buffers
  // the transport payload, so protecting only the Gemini stage is not enough for heap safety.
  let activeOcrBodyParses = 0;
  const MAX_CONCURRENT_OCR_BODY_PARSES = 4;
  const jsonBodyLimitMb = Math.ceil((MAX_RAW_PAYLOAD_BYTES * 1.36) / (1024 * 1024));
  const JSON_BODY_PARSER_LIMIT = `${jsonBodyLimitMb}mb`;
  const jsonParser = express.json({ limit: JSON_BODY_PARSER_LIMIT });
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/extract-schedule') && !req.path.startsWith('/api/parse-schedule-images')) return next();
    if (activeOcrBodyParses >= MAX_CONCURRENT_OCR_BODY_PARSES) {
      return res.status(503).json({ error: 'The schedule reader is busy processing large requests. Please try again shortly.', reasonCode: 'SERVER_BUSY', retryable: true });
    }
    activeOcrBodyParses++;
    let released = false;
    const release = () => { if (released) return; released = true; activeOcrBodyParses = Math.max(0, activeOcrBodyParses - 1); };
    jsonParser(req, res, (err) => { release(); next(err); });
  });

  // The UI may send one logical multi-screenshot OCR request. Keep the parser bound close to
  // the explicit transport guard so oversized JSON bodies are rejected before deep processing.

  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Handle JSON parsing and body-parser payload-too-large errors cleanly without sending HTML
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      structuredServerLog("error", "Express middleware error", { error: serializeServerError(err) });
      const parsedErr = serializeServerError(err);
    if (parsedErr.status === 413 || /entity\.too\.large/i.test(parsedErr.message)) {
        return res.status(413).json({
          error: "Payload too large. Each image has a 50 MB decoded limit and one logical OCR request has a 120 MB decoded aggregate limit.",
          reasonCode: "OCR_CORPUS_TOO_LARGE",
        });
      }
      return res.status(400).json({
        error: "Invalid request payload. If uploading images, ensure valid JSON and base64 formatting.",
      });
    }
    next();
  });

  // Initialize Gemini client lazily/safely
  const getGeminiClient = () => {
    const apiKey = config.geminiApiKey;
    if (!apiKey) {
      return null;
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  // Liveness probe (is the server process running?)
  app.get("/api/health/live", (_req, res) => {
    res.json({
      status: "ok",
      live: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness probe (are critical dependencies configured and ready to accept traffic?)
  app.get("/api/health/ready", (_req, res) => {
    const hasGeminiKey = Boolean(config.geminiApiKey);
    const isReady = hasGeminiKey;

    const payload = {
      status: isReady ? "ok" : "degraded",
      ready: isReady,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies: {
        server: "ok",
        gemini: hasGeminiKey ? "configured" : "unconfigured",
        proxy: config.nodeEnv === 'production' && !config.directDeployment && config.trustedProxyCidrs.length === 0 ? 'misconfigured' : 'configured',
      },
    };

    if (!isReady) {
      return res.status(503).json(payload);
    }
    return res.status(200).json(payload);
  });

  // Combined health check endpoint
  app.get("/api/health", (_req, res) => {
    const hasGeminiKey = Boolean(config.geminiApiKey);
    const isReady = hasGeminiKey;

    const status = isReady ? "ok" : "degraded";
    const statusCode = isReady ? 200 : 503;

    res.status(statusCode).json({
      status,
      service: "Gadwal Course Scheduler",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies: {
        server: "ok",
        gemini: hasGeminiKey ? "configured" : "unconfigured",
        proxy: config.nodeEnv === 'production' && !config.directDeployment && config.trustedProxyCidrs.length === 0 ? 'misconfigured' : 'configured',
      },
    });
  });

  // Live model discovery from Gemini, cached briefly to avoid redundant external calls.
  let modelsCache: { expiresAt: number; models: Array<{ name: string; displayName?: string }> } | null = null;
  let inFlightModelsPromise: Promise<Array<{ name: string; displayName?: string }>> | null = null;

  const diagnosticRateLimiter = new SlidingWindowRateLimiter(10, 60_000, 1_000);

  app.get("/api/models", async (req, res) => {
    if (!config.diagnosticModelsEnabled) return res.status(404).json({ error: 'Not found.' });
    const diagnosticRate = diagnosticRateLimiter.allow(req.ip || req.socket.remoteAddress || 'unknown');
    if (!diagnosticRate.allowed) return res.status(429).json({ error: 'Diagnostic rate limit reached.', reasonCode: 'RATE_LIMITED', retryAfter: diagnosticRate.retryAfterSeconds });
    if (config.nodeEnv === 'production') {
      const provided = req.get('x-gadwal-admin-token') || '';
      const crypto = await import('node:crypto');
      const expected = Buffer.from(config.adminDiagnosticToken);
      const actual = Buffer.from(provided);
      if (!config.adminDiagnosticToken || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return res.status(404).json({ error: 'Not found.' });
      }
    }
    try {
      if (modelsCache && modelsCache.expiresAt > Date.now()) {
        return res.json({ success: true, count: modelsCache.models.length, models: modelsCache.models, cached: true });
      }
      const ai = getGeminiClient();
      if (!ai) {
        const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        console.error(`[Error ${errorId}] Gemini API key is not configured.`);
        return res.status(503).json({
          error: "AI service is currently not configured or unavailable.",
          errorId,
        });
      }

      if (!inFlightModelsPromise) {
        inFlightModelsPromise = (async () => {
          const list = await ai.models.list();
          const models: Array<{ name: string; displayName?: string }> = [];
          for await (const m of list) {
            models.push({
              name: m.name,
              displayName: m.displayName,
            });
          }
          modelsCache = { expiresAt: Date.now() + 60_000, models };
          return models;
        })().finally(() => {
          inFlightModelsPromise = null;
        });
      }

      const models = await inFlightModelsPromise;
      res.json({ success: true, count: models.length, models, cached: false });
    } catch (err: unknown) {
      const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      structuredServerLog("error", "Error listing models", { errorId, error: serializeServerError(err) });
      res.status(500).json({
        error: "Unable to retrieve models at this time. Please try again later.",
        errorId,
      });
    }
  });

  // Concurrency control for resource-intensive OCR corpus requests to protect server process stability
  class Semaphore {
    private active = 0;
    private readonly queue: Array<{ resolve: () => void; reject: (reason?: unknown) => void }> = [];
    private readonly max: number;
    constructor(max: number) { this.max = Math.max(1, max); }
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) throw new Error('CLIENT_ABORTED');
      if (this.active >= this.max) {
        await new Promise<void>((resolve, reject) => {
          const entry = { resolve, reject };
          const onAbort = () => {
            const index = this.queue.indexOf(entry);
            if (index >= 0) this.queue.splice(index, 1);
            reject(new Error('CLIENT_ABORTED'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          this.queue.push({
            resolve: () => { signal?.removeEventListener('abort', onAbort); resolve(); },
            reject: (reason) => { signal?.removeEventListener('abort', onAbort); reject(reason); },
          });
        });
      }
      if (signal?.aborted) throw new Error('CLIENT_ABORTED');
      this.active++;
      try { return await task(); }
      finally {
        this.active = Math.max(0, this.active - 1);
        this.queue.shift()?.resolve();
      }
    }
    get inFlight() { return this.active; }
  }
  const globalWorkSemaphore = new Semaphore(MAX_GLOBAL_CONCURRENT_WORK);

  async function withWorkPermit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error("CLIENT_ABORTED");
    return await globalWorkSemaphore.run(task, signal);
  }

  // Concurrency pool helper for parallel execution with max concurrency
  async function pMap<T, R>(items: T[], fn: (item: T, idx: number) => Promise<R>, concurrency: number = 4): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let index = 0;
    const count = items.length;
    if (count === 0) return [];
    const workers = new Array(Math.min(Math.max(1, concurrency), count)).fill(0).map(async () => {
      while (index < count) {
        const i = index++;
        try {
          results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
        } catch (reason) {
          structuredServerLog("warn", "OCR batch item failed", { index: i, error: serializeServerError(reason) });
          results[i] = { status: 'rejected', reason };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  const modelSuccessCounts = new Map<string, number>();
  const markModelSuccess = (id: string) => {
    modelSuccessCounts.set(id, (modelSuccessCounts.get(id) || 0) + 1);
  };

  // This is intentionally the extraction/read prompt from the last known-working OCR build.
  // Keep the newer canonical schema/validation AFTER the model response, where it cannot
  // change how Gemini visually interprets the screenshot.
  const OCR_SYSTEM_PROMPT = `You are a high-precision university course schedule extractor and OCR vision engine.
Analyze ALL provided images together as ONE visual evidence corpus representing one underlying schedule. Some images may not contain course schedule information — ignore those images without fabricating data. Do NOT treat each image as an independent schedule and do NOT assume that each new occurrence is a new course or section. Read every image before deciding the final extraction. Use overlapping and repeated images as corroborating evidence, and use partial images to complete information from other images.

The images could be:
- A student portal weekly calendar grid or linear schedule table (Banner, Canvas, Blackboard, PeopleSoft, SIS, Edugate, etc.)
- A mobile app screenshot of course registration or enrolled courses
- An English or Arabic university schedule/timetable
- Or a non-schedule document (e.g. syllabus title, campus photo, grade report without times, invoice, meme, blank image)

YOUR OBJECTIVE:
1. Thoroughly search for ALL courses, course sections, and their scheduled meeting times across all provided images.
2. If the images contain NO course schedules or class meeting times at all, output EXACTLY:
   {"sections": []}
3. If course sections ARE found:
   Extract EVERY course and every section visible across all images.
   Output pure JSON with key "sections":
   {
     "sections": [
       {
         "id": "Section code or identifier (e.g. CS101-01, 10442, BUS200-02, Sec 1)",
         "name": "Course title (e.g. Introduction to Computer Science, تفاضل وتكامل 1)",
         "credits": 3,
         "sessions": [
           {
             "day": "MON",
             "start": "09:00",
             "end": "10:15",
             "type": "Lecture"
           }
         ]
       }
     ]
   }

CRITICAL RULES:
1. "day" MUST BE exactly one of: "SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI".
2. DAY RANGE RULE: Courses often meet on specific days. If an image or table says 'Saturday-Wednesday', 'Sat-Wed', 'السبت-الأربعاء', 'Sun-Thu', or 'Su-Th', it names EXACTLY the two meeting days (e.g. Saturday AND Wednesday), NOT intermediate days. Output separate session objects for each specific meeting day.
3. "start" and "end" MUST BE 24-hour "HH:MM" format (e.g. "08:30", "13:00", "14:30"). Convert 12h AM/PM (1:00 PM -> 13:00, 2:30 PM -> 14:30). Convert Arabic numerals (١٢:٣٠ -> 12:30, ٨:٠٠ -> 08:00).
4. "type" MUST be one of: "Lecture", "Lab", "Section", "Tutorial", "Discussion", "Online". Arabic keywords to map:
   - Lab / Practical: معمل, مختبر, عملي, عملى, practical
   - Online / Remote: اونلاين, أونلاين, افتراضي, عن بعد, distance, remote, web, async
   - Section / Recitation: سكشن, شعبة, شعبه, تمارين, recitation
   - Tutorial / Applied: تدريب, تطبيق, tutorial
   - Discussion: مناقشة, مناقش, discussion
   - Lecture: محاضرة, lecture
   If a course has BOTH a Lecture and a Lab or Section, extract ALL sessions under that section.
5. If an image lists multiple sections of a course (e.g. Sec 01, Sec 02, Sec 03), extract ALL sections.
6. If an image lists multiple different courses, extract ALL of them.
7. SCROLLED / OVERLAPPING MESSAGES & SECTION GROUPING RULE:
   - Treat all supplied screenshots as one evidence set. If multiple images show the same message or timetable at different scroll positions, do NOT create duplicate courses/sections/meetings from repeated or overlapping views. Use the clearest and most complete observations as evidence, but preserve complementary information from partial views. If observations genuinely conflict, preserve the conflict rather than silently inventing a value. Read exact days and times carefully (e.g. distinguish Thursday vs Wednesday, Lecture vs Section).
   - Keep course titles and section codes distinct: The course name is the subject title (e.g. 'Statistical Analysis for Business', 'Investment Analysis', 'Capital Markets'). The section code is the specific group identifier (e.g. 'STA31101-BI', 'STA31103', 'FIN434-New01', 'FIN434-New03'). Put the subject title in 'name' and the specific section identifier in 'id'.
   - Do not cross-merge different section codes (e.g. keep STA31101-BI and STA31103 as separate section objects with the same course name 'Statistical Analysis for Business'). If a section identifier appears to be a composite/derived form of the course identifier (e.g. BIM32108-BUS vs BIM3210801-BUS), preserve the raw value and distinguish it from a genuinely separate section; do not create an extra section solely because a longer code contains a short embedded section discriminator.
8. Do NOT extract instructor names or instructor titles as course names.
9. If credits are unknown or not shown, set credits to null. Do NOT guess credits.
10. For every meeting, include source_image_index as the ZERO-BASED index of the image that directly shows the meeting when you can identify it. Include source_record_index as the ZERO-BASED record index when useful. If evidence comes from multiple images, use the strongest direct source and do not invent an index.
11. For difficult fields, you may include confidence as a number from 0 to 1 and a short evidence string. Confidence never replaces validation and never authorizes guessing.
12. Output ONLY valid JSON, no markdown backticks, no commentary.`;

  // OCR corpus processing lives in a dedicated service; this route supplies validated transport/runtime dependencies.
  const extractFromImageCorpus = async (
    ai: GoogleGenAI,
    corpusImages: Array<{ data: string; mimeType: string; sourceIndex?: number }>,
    corpusIndex: number,
    clientSignal?: AbortSignal,
    ocrRunId?: string
  ): Promise<Section[]> => extractOcrCorpus({
    ai,
    prompt: OCR_SYSTEM_PROMPT,
    corpusImages,
    corpusIndex,
    clientSignal,
    ocrRunId,
    markModelSuccess,
  });

  const telemetryRateLimiter = new SlidingWindowRateLimiter(120, 60_000);
  const ALLOWED_TELEMETRY = new Set(['LCP','CLS','INP','FCP','TTFB','FID']);
  app.post('/api/telemetry/web-vitals', express.json({ limit: '12kb' }), (req, res) => {
    const rate = telemetryRateLimiter.allow(req.ip || req.socket.remoteAddress || 'unknown');
    if (!rate.allowed) return res.status(429).json({ ok: false, error: 'Telemetry rate limit reached', reasonCode: 'RATE_LIMITED', retryAfter: rate.retryAfterSeconds });
    const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 64) : '';
    const value = Number(req.body?.value);
    const eventPathRaw = typeof req.body?.path === 'string' ? req.body.path : '';
    const normalizedTelemetryPath = eventPathRaw.startsWith('/') ? eventPathRaw.split('?')[0].split('#')[0].replace(/\/{2,}/g, '/').slice(0, 120) : '/';
    const TELEMETRY_ROUTES = new Set(['/','/add-courses','/results','/about','/guide','/how-it-works','/promise']);
    const eventPath = TELEMETRY_ROUTES.has(normalizedTelemetryPath)
      ? normalizedTelemetryPath
      : normalizedTelemetryPath.startsWith('/add-courses/')
        ? '/add-courses'
        : normalizedTelemetryPath.startsWith('/results/')
          ? '/results'
          : '/other';
    if (!name || !ALLOWED_TELEMETRY.has(name) || !Number.isFinite(value) || Math.abs(value) > 1e9) return res.status(400).json({ ok: false, reasonCode: 'INVALID_TELEMETRY' });
    recordServerMetric({ name, value, path: eventPath });
    res.status(204).end();
  });

  const sanitizeUserOcrEvidence = (value: unknown, depth = 0): unknown => {
    if (depth > 3) return undefined;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 1200);
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeUserOcrEvidence(item, depth + 1)).filter((item) => item !== undefined);
    if (!value || typeof value !== 'object') return undefined;
    const allowed = new Set([
      'sourceChunkIndex','sourceImageIndexes','corpusImageIndexes','sourceImageIndex','model','sourceRecordIndex','ocrRunId',
      'day','days','start','end','start_time','end_time','time','raw_time','type','meeting_type','ambiguousTime','ambiguous_time',
      'confidence','evidence','course_name','course_title','course_code','courseCode','section_code','section_id','section_number',
      'credits','credit_hours','credit_hours_conflict','instructor','tutorial_code','part_time','reason','section_code_missing','needs_review','review_reasons'
    ]);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.has(key)) continue;
      const safe = sanitizeUserOcrEvidence(child, depth + 1);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  };

  // Schedule extraction endpoint (supports both /api/extract-schedule and /api/parse-schedule-images)
  app.post(["/api/extract-schedule", "/api/parse-schedule-images"], async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const rateKey = req.ip || req.socket.remoteAddress || 'unknown';
    const workflowGenerationId = typeof req.body?.workflowGenerationId === 'string' ? req.body.workflowGenerationId.slice(0, 120) : undefined;
    const rate = ocrRateLimiter.allow(rateKey);
    res.setHeader('X-RateLimit-Limit', String(OCR_RATE_LIMIT_PER_MINUTE));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'OCR request limit reached. Please wait before trying again.', reasonCode: 'RATE_LIMITED', retryAfter: rate.retryAfterSeconds });
    }

    // Abort only when the client actually aborts the HTTP request.
    // IncomingMessage "close" also fires after a normal request body completes
    // (Node >=16), so using req.on("close") here cancels every successful upload
    // immediately after JSON parsing. This was the primary screenshot-failure bug.
    const clientController = new AbortController();
    const handleClientAbort = () => {
      if (!clientController.signal.aborted && !res.writableEnded && !res.headersSent) {
        clientController.abort(new Error("Client disconnected"));
      }
    };
    req.on("aborted", handleClientAbort);
    req.on("close", () => {
      if (req.destroyed && !req.complete && !res.writableEnded && !res.headersSent) {
        handleClientAbort();
      }
    });

    try {
      const ocrRunId = randomUUID();
      const body = req.body || {};
      const allowedKeys = new Set(["image", "images", "mimeType", "text"]);
      if (typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.has(key))) {
        return res.status(400).json({ error: "Invalid request shape. Unexpected fields are not accepted.", reasonCode: "INVALID_REQUEST" });
      }
      const { image, images, mimeType, text } = body;
      const hasImagesField = Array.isArray(images) && images.length > 0;
      const hasSingleImage = typeof image === "string" && image.trim().length > 0;
      const hasText = typeof text === "string" && text.trim().length > 0;
      if ((hasImagesField ? 1 : 0) + (hasSingleImage ? 1 : 0) + (hasText ? 1 : 0) === 0) {
        return res.status(400).json({ error: "No image or text payload was provided.", reasonCode: "INVALID_REQUEST" });
      }
      if ((hasImagesField ? 1 : 0) + (hasSingleImage ? 1 : 0) + (hasText ? 1 : 0) > 1) {
        return res.status(400).json({ error: "Provide either images or text, not multiple payload types at once." });
      }

      const ai = getGeminiClient();

      if (!ai) {
        return res.status(503).json({
          error: "AI service key is not configured. Please paste your schedule text or enter courses manually in the meantime.",
          reasonCode: "UPSTREAM_ERROR",
        });
      }

      const imageList: Array<{ data: string; mimeType: string; sourceIndex: number }> = [];

      if (Array.isArray(images) && images.length > 0) {
        if (images.length > MAX_IMAGES_PER_REQUEST) {
          return res.status(413).json({ error: `Too many images. Maximum is ${MAX_IMAGES_PER_REQUEST} images per request.`, reasonCode: "INVALID_REQUEST" });
        }
        let totalDecodedBytes = 0;

        for (let i = 0; i < images.length; i++) {
          const imgItem = images[i];
          const raw = typeof imgItem === "string" ? imgItem : (imgItem && typeof imgItem === "object" ? imgItem.data : null);
          if (typeof raw !== "string" || !raw.trim()) {
            return res.status(400).json({
              error: `Image at index ${i + 1} contains no valid image data string.`,
            });
          }

          const clean = raw.startsWith("data:") && raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
          if (!isValidBase64(clean)) {
            return res.status(400).json({ error: `Image at index ${i + 1} contains invalid base64 data.` });
          }
          const rawMime = (typeof imgItem === "object" && imgItem && imgItem.mimeType) || "image/jpeg";
          const formatCheck = detectOrValidateImageFormat(clean, typeof rawMime === "string" ? rawMime.toLowerCase() : "image/jpeg");
          if (!formatCheck.valid) {
            return res.status(400).json({ error: `Image at index ${i + 1} does not match a supported image format (PNG, JPG, or WebP).` });
          }
          const mime = formatCheck.detectedMime;
          const decodedBytes = getDecodedBase64ByteLength(clean);
          const dimensions = getImageDimensions(clean, mime);
          if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
            return res.status(400).json({ error: `Image at index ${i + 1} has invalid or unsafe dimensions. Maximum supported size is ${MAX_IMAGE_DIMENSION}px per side and ${MAX_IMAGE_PIXELS.toLocaleString()} pixels.`, reasonCode: 'INVALID_IMAGE' });
          }

          if (decodedBytes === 0) {
            return res.status(400).json({
              error: `Image at index ${i + 1} contains invalid or empty base64 data.`,
            });
          }

          if (decodedBytes > MAX_SINGLE_IMAGE_BYTES) {
            const sizeMb = (decodedBytes / (1024 * 1024)).toFixed(1);
            return res.status(413).json({
              error: `Image at index ${i + 1} exceeds the per-image limit of ${Math.round(MAX_SINGLE_IMAGE_BYTES / (1024 * 1024))} MB (decoded size: ${sizeMb} MB). Please compress or crop this screenshot.`,
              reasonCode: 'IMAGE_TOO_LARGE',
            });
          }

          totalDecodedBytes += decodedBytes;
          if (totalDecodedBytes > MAX_TOTAL_IMAGES_BYTES) {
            const totalMb = (totalDecodedBytes / (1024 * 1024)).toFixed(1);
            return res.status(413).json({
              error: `The complete OCR screenshot set exceeds the ${Math.round(MAX_TOTAL_IMAGES_BYTES / (1024 * 1024))} MB decoded corpus limit (accumulated: ${totalMb} MB). Remove or compress screenshots and try again.`,
              reasonCode: 'OCR_CORPUS_TOO_LARGE',
            });
          }

          imageList.push({ data: clean, mimeType: mime, sourceIndex: i });
        }
      } else if (image) {
        if (typeof image !== "string" || !image.trim()) {
          return res.status(400).json({
            error: "Image payload contains no valid image data.",
          });
        }

        const cleanBase64 = image.startsWith("data:") && image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
        if (!isValidBase64(cleanBase64)) {
          return res.status(400).json({ error: "Image payload contains invalid base64 data." });
        }
        const rawMime = mimeType || "image/jpeg";
        const formatCheck = detectOrValidateImageFormat(cleanBase64, typeof rawMime === "string" ? rawMime.toLowerCase() : "image/jpeg");
        if (!formatCheck.valid) {
          return res.status(400).json({ error: "Image does not match a supported image format (PNG, JPG, or WebP)." });
        }
        const validMime = formatCheck.detectedMime;
        const decodedBytes = getDecodedBase64ByteLength(cleanBase64);
        const dimensions = getImageDimensions(cleanBase64, validMime);
        if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
          return res.status(400).json({ error: 'Image has invalid or unsafe dimensions.', reasonCode: 'INVALID_IMAGE' });
        }

        if (decodedBytes === 0) {
          return res.status(400).json({
            error: "Image payload contains invalid or empty base64 data.",
          });
        }

        if (decodedBytes > MAX_SINGLE_IMAGE_BYTES) {
          const sizeMb = (decodedBytes / (1024 * 1024)).toFixed(1);
          return res.status(413).json({
            error: `Image exceeds the per-image limit of ${Math.round(MAX_SINGLE_IMAGE_BYTES / (1024 * 1024))} MB (decoded size: ${sizeMb} MB). Please compress or crop the screenshot before uploading.`,
            reasonCode: 'IMAGE_TOO_LARGE',
          });
        }

        imageList.push({ data: cleanBase64, mimeType: validMime, sourceIndex: 0 });
      }

      if (typeof text === "string" && Buffer.byteLength(text, "utf8") > 5 * 1024 * 1024) {
        return res.status(413).json({ error: "Text payload exceeds maximum allowed limit of 5 MB.", reasonCode: "INVALID_REQUEST" });
      }

      let allExtractedSections: Section[] = [];

      if (imageList.length > 0) {
        // ONE logical OCR corpus request: every supplied screenshot is presented to Gemini together.
        // There is intentionally no image splitting here. Global reconciliation happens
        // after this single coherent visual pass.
        console.log(`[OCR Multi-Image Engine] Processing ONE corpus request containing ${imageList.length} image(s)...`);
        allExtractedSections = await withWorkPermit(
          () => extractFromImageCorpus(ai, imageList, 0, clientController.signal, ocrRunId),
          clientController.signal
        );
      
      } else if (text) {
        let hadTextResponse = false;
        let hadTextUnparseable = false;
        const textDeadline = Date.now() + Math.min(OCR_PROVIDER_TOTAL_BUDGET_MS, 30000);
        if (typeof text !== "string" || !text.trim()) {
          return res.status(400).json({ error: "Provided text payload is empty." });
        }

        // Text extraction uses the same typed provider fallback service as image extraction.
        const textResult = await runOcrWithModelFallback<Section[]>({
          multi: false,
          parentSignal: clientController.signal,
          execute: ({ modelId, thinkingLevel }, signal) => ai.models.generateContent({
            model: modelId,
            contents: [{ text: `${OCR_SYSTEM_PROMPT}\n\nHere is the raw text to extract courses from:\n\n${text}` }],
            config: { systemInstruction: OCR_SYSTEM_PROMPT, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: thinkingLevel as never }, abortSignal: signal },
          }),
          parse: (raw, modelId) => {
            hadTextResponse = true;
            const responseText = typeof (raw as { text?: unknown })?.text === 'string' ? (raw as { text: string }).text : '';
            const parsed = parseOcrJsonPayload(responseText);
            if (!parsed) { hadTextUnparseable = true; return null; }
            const canonicalInput = adaptLegacyOcrPayload(parsed);
            if (!validateOcrModelShape(canonicalInput).valid) { hadTextUnparseable = true; return null; }
            markModelSuccess(modelId);
            return canonicalToAppSections(modelOutputToCanonical(canonicalInput, { sourceChunkIndex: 0, sourceImageIndexes: [], model: modelId, ocrRunId }));
          },
          onModelFailure: (modelId, error) => structuredServerLog('warn', 'Text OCR model attempt failed', { modelId, error: serializeServerError(error) }),
        });
        if (textResult) allExtractedSections = textResult.value;
        if (allExtractedSections.length === 0 && hadTextResponse && hadTextUnparseable) {
          const error = new Error('MODEL_UNPARSEABLE');
          (error as Error & { reasonCode?: string }).reasonCode = 'MODEL_UNPARSEABLE';
          throw error;
        }
      } else {
        return res.status(400).json({ error: "Missing image or text payload" });
      }

      const reconciledSections = reconcileOCRSections(allExtractedSections as Section[]);
      if (reconciledSections.length > 0) {
        const semantic = validateOCRSections(reconciledSections);
        if (!semantic.valid) {
          console.warn(`[OCR ${ocrRunId}] Semantic validation failed:`, semantic.reasons);
          return res.status(502).json({ error: 'The extraction service returned schedule data that did not pass safety checks. Please retry.', reasonCode: 'SEMANTIC_VALIDATION_FAILED', validationReasons: semantic.reasons });
        }
      }
      const cleanOutputSections = reconciledSections.map((s) => ({
        id: s.id,
        name: s.name,
        credits: s.credits,
        sessions: s.sessions.map((session) => { const normalized = normalizeMeetingType(session?.type); return { ...session, type: normalized.type, ...(normalized.customType ? { customType: normalized.customType } : {}), }; }),
        courseKey: s.courseKey,
        courseCode: s.courseCode ?? null,
        sectionCode: s.sectionCode ?? null,
        rawSectionCode: s.rawSectionCode ?? s.sectionCode ?? null,
        canonicalSectionKey: s.canonicalSectionKey ?? null,
        ...(s.rawSectionCodeVariants?.length ? { rawSectionCodeVariants: s.rawSectionCodeVariants } : {}),
        sectionCodeMissing: Boolean(s.sectionCodeMissing),
        needsReview: Boolean(s.needsReview),
        reviewReasons: s.reviewReasons || [],
        conflictingMeetings: s.conflictingMeetings || [],
        creditHoursConflict: s.creditHoursConflict || null,
        codeInferred: Boolean(s.codeInferred),
        courseCodeInferenceSource: s.courseCodeInferenceSource ?? 'unknown',
        sourceImageIndexes: s.sourceImageIndexes || [],
        ocrRunId: s.ocrRunId || ocrRunId,
        ...(workflowGenerationId ? { workflowGenerationId } : {}),
        tutorialCode: s.tutorialCode ?? null,
        partTime: s.partTime ?? null,
        ...(s.incompleteMeetings?.length ? { incompleteMeetings: s.incompleteMeetings } : {}),
        ...(s.rawOcrEvidence?.length ? { rawOcrEvidence: s.rawOcrEvidence.map((e) => sanitizeUserOcrEvidence(e)).filter((e) => e !== undefined) } : {}),
      }));

      console.log(`[OCR Engine] Final output: ${cleanOutputSections.length} section(s) across ${new Set(reconciledSections.map((s) => s.courseKey || s.name)).size} course(s).`);

      if (cleanOutputSections.length === 0) {
        return res.status(200).json({ success: true, sections: [], reasonCode: 'NO_SCHEDULE_FOUND', message: 'No supported schedule information was found in the supplied input.' });
      }

      const responseBody = {
        success: true,
        sections: cleanOutputSections,
        stats: {
          totalImages: imageList.length,
          totalCourses: new Set(cleanOutputSections.map((s) => s.courseKey || `${s.courseCode || ''}|${s.name || ''}`)).size,
          totalSections: cleanOutputSections.length,
          ocrRunId,
        },
        reasonCode: "SUCCESS",
        ocrRunId,
        ...(workflowGenerationId ? { workflowGenerationId } : {}),
      };
      const contract = validateOcrApiResponse(responseBody);
      if (!contract.valid) {
        return res.status(502).json({ error: 'The extraction service produced an invalid response contract. Please retry.', reasonCode: 'RESPONSE_CONTRACT_FAILED', retryable: true, errorId: `ocr_${Date.now().toString(36)}` });
      }
      return res.json(responseBody);
    } catch (err: unknown) {
      const safeError = serializeServerError(err);
      structuredServerLog('error', 'OCR extraction failed', { error: safeError });
      if (safeError.message === 'CLIENT_ABORTED') return;
      if (res.headersSent) return;
      const isRateLimit = safeError.status === 429 || /429|quota|rate limit|resource_exhausted/i.test(safeError.message);
      const reasonCode = safeError.code || (isRateLimit ? 'UPSTREAM_BUSY' : 'UPSTREAM_ERROR');
      const status = isRateLimit ? 503 : 502;
      const payload: { error: string; reasonCode: string; retryAfter?: number; retryable: boolean; errorId: string } = {
        error: isRateLimit
          ? 'The schedule reading service is currently busy. Please try again in a moment.'
          : reasonCode === 'MODEL_UNPARSEABLE'
          ? 'The extraction service returned an unreadable model response. Please retry.'
          : 'We encountered an issue processing your request. Please try again or add courses manually.',
        reasonCode,
        retryable: [408, 429, 500, 502, 503, 504].includes(status) || isRateLimit || reasonCode === 'UPSTREAM_BUSY',
        errorId: `ocr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      };
      if (typeof safeError.retryAfter === 'number') payload.retryAfter = safeError.retryAfter;
      return res.status(status).json(payload);
    } finally {
      req.off("aborted", handleClientAbort);
    }
  });

  registerHealthRoutes(app);
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.', reasonCode: 'NOT_FOUND' }));
  await configureFrontendServing(app, config);

  // Final catch-all error middleware
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    structuredServerLog("error", "Server catch-all error", { errorId, error: serializeServerError(err) });
    res.status(500).json({
      error: "An unexpected internal error occurred. Please try again later.",
      errorId,
    });
  });
  const server = http.createServer(app);
  server.requestTimeout = OCR_END_TO_END_BUDGET_MS;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000;
  server.timeout = OCR_END_TO_END_BUDGET_MS + 5_000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Gadwal Course Scheduler running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
