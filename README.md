<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a7f600bf-94b1-44c6-b223-2cadee152e61

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## OCR architecture — single logical screenshot corpus

The screenshot extraction flow intentionally sends the complete selected screenshot set in one logical OCR request. Screenshots are not partitioned into independent OCR batches. Gemini is instructed to treat all supplied images as one visual evidence corpus, after which the server performs global course/section/meeting reconciliation and deduplication.

See `QA_IMPLEMENTATION_AUDIT_FINAL.md` for the verification matrix and remaining environment-dependent release checks.
