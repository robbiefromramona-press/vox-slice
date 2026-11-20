// Screenshot helper: node tests/e2e/shots.mjs <label>   (label = before | after)
// Needs `npm run serve:dist` running. Saves docs/<label>-*.png (empty state, transcribed + clips, export, mobile).
import { launchFresh, openApp, loadAndWait, audio, tid, sourceWords, makeClip, ROOT } from './lib.mjs';
import { findSeq } from './lib.mjs';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const label = process.argv[2] || 'after';
const dir = path.join(ROOT, 'docs'); mkdirSync(dir, { recursive: true });
const out = (n) => path.join(dir, `${label}-${n}.png`);
const { browser, ctx } = await launchFresh();
const page = await openApp(ctx);
await page.waitForTimeout(800);
await page.screenshot({ path: out('1-empty'), fullPage: false });
await loadAndWait(page, audio('clean.wav'));
const words = await sourceWords(page);
for (const [i, seq] of [[0, ['bread']], [1, ['bridge']], [2, ['thank', 'you', 'very', 'much']]]) {
  const a = findSeq(words, seq, 0); if (a >= 0) await makeClip(page, a, a + seq.length - 1, 'enter');
}
await page.waitForTimeout(600);
await page.screenshot({ path: out('2-transcribed'), fullPage: false });
await tid(page, 'export-zip-btn').scrollIntoViewIfNeeded();
const dl = page.waitForEvent('download');
await tid(page, 'export-zip-btn').click(); await dl;
await page.waitForTimeout(600);
await page.screenshot({ path: out('3-exported'), fullPage: true });
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage(); await mp.goto(process.env.BASE || 'http://localhost:5190/');
await mp.waitForTimeout(1200);
await mp.screenshot({ path: out('4-mobile') });
await browser.close();
console.log('saved', label);
