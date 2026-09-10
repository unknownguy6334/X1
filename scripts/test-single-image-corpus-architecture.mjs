import fs from 'node:fs';
import assert from 'node:assert/strict';

const client = fs.readFileSync(new URL('../src/components/StepAddCourses.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const prompt = server.match(/const OCR_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] || '';

assert.match(client, /body:\s*JSON\.stringify\(\{\s*images:\s*prepared\.map/,
  'Client must send the prepared screenshot set as one images array.'
);
assert.doesNotMatch(client, /const batches: Array<typeof prepared>/,
  'Client must not create independent OCR batches.'
);
assert.doesNotMatch(client, /CHUNK_SIZE/,
  'Client OCR flow must not use image chunking.'
);
assert.doesNotMatch(server, /const CHUNK_SIZE = 4/,
  'Server OCR endpoint must not partition the screenshot corpus into chunks.'
);
assert.match(prompt, /ALL provided images together as ONE visual evidence corpus/i,
  'OCR prompt must explicitly define the complete image set as one evidence corpus.'
);
assert.match(prompt, /Do NOT treat each image as an independent schedule/i,
  'OCR prompt must prohibit independent-image schedule interpretation.'
);
console.log('PASS: single logical screenshot-corpus architecture is enforced.');
