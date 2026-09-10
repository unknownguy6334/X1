# GADWAL Screenshot Upload Audit Result

## Scope

Audited the complete screenshot-input experience from file selection through the point where screenshots are ready for OCR, including the React upload workspace, upload state, image preprocessing, persistence/reset behavior, OCR request flow, server validation, provider fallback, accessibility, responsiveness, memory safety, and stale-state risks.

The audit was performed against the latest GADWAL source ZIP being implemented in this task.

## Findings and implemented fixes

### 🔴 BUG #1
Where: `src/components/StepAddCourses.tsx`, screenshot selection and OCR flow

What I found:
Adding screenshots after a previous successful OCR run only processed the newly selected files. The new response then replaced `pendingParsedSections`, so previously extracted course information could disappear.

Why it matters:
The screenshot workspace is presented as one logical evidence set. Adding another screenshot could silently discard earlier extracted information.

What should happen:
The full current screenshot set should be reconsidered together whenever the set changes.

Implemented fix:
New uploads now invalidate the old review state and re-run the complete current screenshot set through the same OCR evidence request.

### 🔴 BUG #2
Where: `src/components/StepAddCourses.tsx`, OCR response handling

What I found:
The batch generation counter existed, but the response path did not check it before applying returned OCR data.

Why it matters:
A late provider response could arrive after Clear All or Cancel and restore stale extracted data.

What should happen:
Only the current OCR generation may update screenshot or review state.

Implemented fix:
The response path now checks both the active AbortSignal and the batch generation before parsing or applying the result.

### 🔴 BUG #3
Where: `src/components/StepAddCourses.tsx`, screenshot preparation/reset interaction

What I found:
File identity work is asynchronous. A Clear All action during that preparation window could race with the still-running preparation callback.

Why it matters:
A file that the user thought was removed could be inserted back into state after an asynchronous hash/fingerprint operation finished.

What should happen:
Reset must invalidate in-flight file preparation as well as OCR.

Implemented fix:
Added a file-preparation generation token and preparation lock. Reset invalidates the preparation generation, and the async selection path refuses to commit stale results.

### 🔴 BUG #4
Where: `src/components/StepAddCourses.tsx`, Retry Failed Screenshots

What I found:
Retrying failed screenshots used only the failed IDs, which broke the one-logical-evidence-set rule when other screenshots in the current set had already succeeded.

Why it matters:
Cross-image reconciliation can produce different results when the failed image is retried without the rest of its evidence.

What should happen:
Retry should evaluate the complete current screenshot set together.

Implemented fix:
Retry now reprocesses every current screenshot, not just failed items.

### 🔴 BUG #5
Where: `src/components/StepAddCourses.tsx`, OCR fetch request

What I found:
The client fetch had no independent hard timeout. Server-side timeouts did not guarantee that the browser request would stop waiting promptly.

Why it matters:
A network or intermediary failure could leave the UI waiting for an unnecessarily long time.

What should happen:
The client should have its own upper time bound and show a clear timeout message.

Implemented fix:
Added a 95-second client request timeout and mapped it to the existing friendly timeout message.

### 🟠 UI PROBLEM #6
Where: `src/components/StepAddCourses.tsx`, screenshot error reporting

What I found:
`ocrError`, `ocrNotice`, and reconnect messaging were stored but not rendered in the screenshot workspace.

Why it matters:
General validation, transport, and OCR failures could be invisible even though the state contained a useful message.

What should happen:
Important upload errors and notices should be visible next to the workspace.

Implemented fix:
Added visible, accessible error, notice, and offline message regions with `role="alert"` / live status semantics.

### 🟠 UI PROBLEM #7
Where: `src/components/StepAddCourses.tsx` and `src/index.css`, screenshot rows

What I found:
The existing failure state reused a large generic notice style inside a compact file row. Long filenames were also hard-truncated with ellipsis.

Why it matters:
The file list could become visually noisy, and users could be unable to read the actual filename.

What should happen:
Screenshot rows should remain compact while still exposing the complete filename and a clear failure state.

Implemented fix:
Added a dedicated file status style, made failure status red and bold, and changed filenames to wrap rather than truncate.

### 🟡 UX ISSUE #8
Where: `src/components/StepAddCourses.tsx` and `src/index.css`, drag and drop

What I found:
Drop handling existed, but the upload workspace had no visual indication while a file was being dragged over it.

Why it matters:
Users get no confirmation that the current area will accept the drop.

What should happen:
The workspace should visibly acknowledge drag-over state without introducing decorative effects.

Implemented fix:
Added a restrained drag-over border/background state and proper drag-enter/leave/drop handling.

### 🟠 UI PROBLEM #9
Where: screenshot upload workspace

What I found:
The loading system stored detailed progress numbers even though the intended student-facing experience is a simple extraction state.

Why it matters:
Showing implementation-style progress can make a short OCR operation feel technical and can expose internal request details rather than the useful user state.

What should happen:
The student-facing state should say `Extracting...` with an animated indeterminate indicator.

Implemented fix:
The visible loading state now stays indeterminate and uses `Extracting...`; internal counters remain internal and are not rendered as progress numbers.

### ⚡ PERFORMANCE #10
Where: `src/components/StepAddCourses.tsx`, duplicate handling

What I found:
Duplicate detection used only filename, size, and modified-time signatures. Two different files sharing those metadata values could be treated as the same file, while the same image with changed metadata could be sent again.

Why it matters:
Metadata is not reliable content identity and can waste OCR work or incorrectly suppress a valid image.

What should happen:
Exact duplicate handling should use file content when browser cryptography is available.

Implemented fix:
Added SHA-256 content hashing. Exact content duplicates are skipped before OCR. Metadata signature remains a lightweight local guard.

### ⚠️ EDGE CASE #11
Where: `src/components/StepAddCourses.tsx`, duplicate screenshot handling

What I found:
There was no distinction between exact duplicates and visually similar screenshots.

Why it matters:
Near-duplicates can be legitimate overlapping timetable views and should not be deleted automatically, but they are useful for users to know about.

What should happen:
Exact duplicates can be removed safely; near-duplicates should remain available as evidence.

Implemented fix:
Added a small visual fingerprint and Hamming-distance similarity check. Similar screenshots are warned about but kept.

### ⚡ PERFORMANCE #12
Where: `src/utils/imageFileAnalysis.ts`

What I found:
Visual comparison could become memory-heavy if it decoded full-size images solely to compare them.

Why it matters:
Large mobile screenshots can consume significant temporary memory.

What should happen:
Similarity detection should use a tiny derived representation.

Implemented fix:
The fingerprint decoder requests a 16×16 bitmap before generating the grayscale fingerprint.

### 🛠️ CODE / ARCHITECTURE #13
Where: `src/features/courseBuilder/model.ts`

What I found:
The upload model had no place for stable content identity or similarity metadata.

Why it matters:
Keeping this information outside the upload model would encourage parallel state and duplicate logic.

What should happen:
The upload record should own its identity metadata.

Implemented fix:
Added optional `contentHash` and `visualFingerprint` fields to `UploadedFileItem`.

### 🔐 SECURITY #14
Where: `server.ts`, OCR request envelope and body parsing

What I found:
The server accepted very large logical OCR request limits and used a 700 MB JSON parser ceiling while the client produced one multi-image request.

Why it matters:
Oversized JSON/base64 requests can create avoidable memory pressure before provider work begins.

What should happen:
Transport limits should be explicit and bounded close to actual application needs.

Implemented fix:
Aligned the client/server workspace at 30 screenshots, reduced decoded aggregate protection to 120 MB, reduced raw JSON protection to 170 MB, and matched the Express JSON parser to that ceiling.

### 🔴 BUG #15
Where: `server.ts`, Gemini model fallback registry

What I found:
The fallback registry still contained `gemini-3.1-flash-lite-preview`, which is shut down.

Why it matters:
A fallback chain containing a permanently unavailable model can turn provider failures into repeated unnecessary failures.

What should happen:
The fallback registry should contain currently supported models only.

Implemented fix:
Removed the shutdown model from the registry. Google currently lists `gemini-3.1-flash-lite` as its replacement and lists Gemini 3.8 Flash as a current production model. citeturn145574search1turn145574search3

### 🔴 BUG #16
Where: `src/components/StepAddCourses.tsx`, client/server OCR contract

What I found:
The implementation had contradictory comments about browser versus server chunking and the previous transport limits did not match the actual one-request behavior.

Why it matters:
Contradictory architecture comments make later maintenance unsafe and can cause someone to reintroduce incompatible batching.

What should happen:
The implementation should clearly enforce one logical screenshot evidence set with bounded transport limits.

Implemented fix:
Clarified and aligned client and server limits, kept one logical multi-image OCR request, and removed the misleading large-parser configuration.

### 🛠️ CODE / ARCHITECTURE #17
Where: `src/components/StepAddCourses.tsx`, clear/reset paths

What I found:
Clear All reset uploaded files and OCR state but did not explicitly reset the workflow reducer phase.

Why it matters:
The visual panel could be reset while the underlying workflow phase still described a prior extraction state.

What should happen:
A complete screenshot reset should reset workflow state too.

Implemented fix:
Clear All now dispatches `RESET` in the course-builder workflow reducer.

### ⚠️ EDGE CASE #18
Where: `src/components/StepAddCourses.tsx`, file selection

What I found:
The screenshot queue had no explicit maximum image count even though the OCR request was intentionally one logical request.

Why it matters:
A user could create a very large in-memory request and provider payload.

What should happen:
The upload workspace should establish a practical, consistent bound.

Implemented fix:
Added a 30-screenshot workspace cap and matched it on the server.

## Verification notes

The implementation was checked after the changes for syntax, source invariants, screenshot-specific behavior, and important surrounding regressions.

The following checks passed:

- TypeScript/TSX parser: 50 files, 0 parse diagnostics.
- Screenshot-upload implementation verification: 23/23 checks passed.
- GADWAL voice audit.
- Responsive architecture: 22/22.
- Source structure: 17/17.
- Single-image corpus architecture check.
- Global UI audit: 55/55.
- Homepage/navigation implementation verification: all checks passed.

The full dependency-backed production build/typecheck was not run because the ZIP does not contain `node_modules`; the environment's package installation path was not available during this task.

## Items that remain runtime-dependent

Provider availability, real browser file-picker behavior, actual drag-and-drop behavior across browsers, and end-to-end Gemini OCR quality still require a live runtime test. The source now contains the required guards and user-state handling, but source inspection alone cannot prove external provider availability or every browser's native image decoding behavior.
