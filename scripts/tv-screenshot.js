/* Screenshot tool for TV design iteration.
 * Compares existing dashboard pages with the TV page to surface visual differences.
 * Usage (Windows):  node.exe scripts/tv-screenshot.js [--suffix=<tag>]
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge found');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const suffix = args.suffix ? '-' + args.suffix : '';

// TV 4K viewport is 3840x2160. Topbar is 96px tall. Each quadrant is ~1920x1032.
// We capture the TV page at 4K then crop each quadrant separately (matches baseline size).
const TV_TOP = 96;
const TV_QW = 1920;
const TV_QH = 1032;
const TARGETS = [
  { name: 'dashboard',   url: 'http://localhost:7777/',                  width: 1920, height: 1080 },
  { name: 'temperature', url: 'http://localhost:7777/temperature',       width: 1920, height: 1080 },
  { name: 'ups',         url: 'http://localhost:7777/ups',               width: 1920, height: 1080 },
  { name: 'alarms',      url: 'http://localhost:7777/alarms',            width: 1920, height: 1080 },
  { name: 'tv-fhd',      url: 'http://localhost:7777/tv/index.html',     width: 1920, height: 1080 },
  { name: 'tv-4k',       url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160 },
  { name: 'tv-q-eq',     url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160, clip: { x: 0,        y: TV_TOP,        width: TV_QW, height: TV_QH } },
  { name: 'tv-q-sensor', url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160, clip: { x: TV_QW,     y: TV_TOP,        width: TV_QW, height: TV_QH } },
  { name: 'tv-q-alarms', url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160, clip: { x: 0,        y: TV_TOP+TV_QH,  width: TV_QW, height: TV_QH } },
  { name: 'tv-q-ups',    url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160, clip: { x: TV_QW,     y: TV_TOP+TV_QH,  width: TV_QW, height: TV_QH } },
  { name: 'tv-topbar',   url: 'http://localhost:7777/tv/index.html',     width: 3840, height: 2160, clip: { x: 0, y: 0, width: 3840, height: TV_TOP } },
  { name: 'dash-topbar', url: 'http://localhost:7777/',                  width: 1920, height: 1080, clip: { x: 0, y: 0, width: 1920, height: 56 } },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-web-security'],
  });
  try {
    for (const t of TARGETS) {
      const page = await browser.newPage();
      await page.setViewport({ width: t.width, height: t.height, deviceScaleFactor: 1 });
      console.log(`[${t.name}] ${t.url} @ ${t.width}x${t.height}`);
      try {
        await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        console.warn(`[${t.name}] goto warning:`, e.message);
      }
      // Give animations a beat to settle (same frame for reproducibility)
      await new Promise((r) => setTimeout(r, 1500));
      const out = path.join(SHOT_DIR, `${t.name}${suffix}.png`);
      const shotOpts = { path: out, fullPage: false };
      if (t.clip) shotOpts.clip = t.clip;
      await page.screenshot(shotOpts);
      console.log(`  → ${out}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
