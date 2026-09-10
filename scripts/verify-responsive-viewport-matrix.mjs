import process from 'node:process';

const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];
const BASE_URL = process.env.RESPONSIVE_BASE_URL || 'http://127.0.0.1:5173';

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.error('Responsive viewport matrix requires the dev dependency "playwright". Run npm install first.');
  process.exit(2);
}

const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 820 }, deviceScaleFactor: 1 });
  const failures = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width <= 414 ? 800 : 900 });
    await page.goto(`${BASE_URL}/#home`, { waitUntil: 'networkidle' });
    const result = await page.evaluate(() => {
      const body = document.body;
      const doc = document.documentElement;
      const fixed = [...document.querySelectorAll('.fixed, .sticky')];
      const clipped = fixed.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1;
      });
      return {
        overflowWidth: Math.max(body.scrollWidth, doc.scrollWidth) - window.innerWidth,
        clippedFixed: clipped.length,
      };
    });
    if (result.overflowWidth > 1 || result.clippedFixed > 0) failures.push({ width, ...result });
  }
  if (failures.length) {
    console.error('Responsive viewport matrix failures:', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log(`Responsive viewport matrix passed for ${WIDTHS.join(', ')}px.`);
} finally {
  await browser.close();
}
