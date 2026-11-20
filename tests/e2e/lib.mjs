// Shared helpers for the Vox-Slice end-to-end suite.
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';
import { wordMatch, normWords } from '../lib/wer.mjs';

export { wordMatch, normWords, JSZip };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AUDIO = path.join(ROOT, 'tests', 'audio');
export const OUT = path.join(ROOT, 'tests', 'out');
export const SHOTS = path.join(OUT, 'shots');
export const DL = path.join(OUT, 'downloads');
export const PROFILE = path.join(OUT, 'profile');
export const BASE = (process.env.BASE || 'http://localhost:5190').replace(/\/$/, '');
export const CREDS = process.env.VOX_USER ? { username: process.env.VOX_USER, password: process.env.VOX_PASS || '' } : undefined;
export const audio = (n) => path.join(AUDIO, n);
export const script = (n) => readFileSync(audio(n), 'utf8').replace(/^﻿/, '');
for (const d of [OUT, SHOTS, DL, PROFILE]) mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- results
export const results = [];       // { test, name, pass, detail }
export const metrics = {};       // free-form numbers per test
export const hygiene = { consoleErrors: [], pageErrors: [], hosts: new Map(), bodies: [], nonGet: [] };
let currentTest = 'setup';
export let expectErrors = false;
export function setCurrentTest(name) { currentTest = name; expectErrors = false; }
export function allowConsoleErrors() { expectErrors = true; }

export function check(name, pass, detail = '') {
  pass = !!pass;
  results.push({ test: currentTest, name, pass, detail: String(detail) });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  [' + detail + ']' : ''}`);
  return pass;
}
export function info(name, value) {
  (metrics[currentTest] ||= {})[name] = value;
  console.log(`  INFO  ${name}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pct = (x) => (Math.round(x * 10) / 10).toFixed(1);

// ---------------------------------------------------------------- browser
// BROWSER = chromium (default) | msedge | firefox | webkit | iphone (WebKit with an iPhone profile)
export const BROWSER = process.env.BROWSER || 'chromium';
const LAUNCH_ARGS = BROWSER === 'chromium' || BROWSER === 'msedge' ? ['--enable-precise-memory-info', '--js-flags=--expose-gc'] : [];
const engine = { chromium, msedge: chromium, firefox, webkit, iphone: webkit }[BROWSER];
if (!engine) throw new Error('Unknown BROWSER ' + BROWSER);
const channel = BROWSER === 'msedge' ? { channel: 'msedge' } : {};
const ctxOpts = () => (BROWSER === 'iphone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
export async function launchShared() {
  return engine.launchPersistentContext(PROFILE + '-' + BROWSER, {
    headless: true, acceptDownloads: true, httpCredentials: CREDS, ...channel, ...ctxOpts(), args: LAUNCH_ARGS,
  });
}
export async function launchFresh() {
  const browser = await engine.launch({ headless: true, ...channel, args: LAUNCH_ARGS });
  const ctx = await browser.newContext({ acceptDownloads: true, httpCredentials: CREDS, ...ctxOpts() });
  return { browser, ctx };
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
export function hostAllowed(h) {
  return LOCAL.has(h) || h === 'huggingface.co' || h.endsWith('.huggingface.co') || h === 'hf.co' || h.endsWith('.hf.co')
    || h === new URL(BASE).hostname;
}
const instrumented = new WeakSet();
export function instrument(ctx) {
  if (instrumented.has(ctx)) return;
  instrumented.add(ctx);
  ctx.on('request', (req) => {
    let u; try { u = new URL(req.url()); } catch { return; }
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return;
    const key = u.hostname;
    hygiene.hosts.set(key, (hygiene.hosts.get(key) || 0) + 1);
    const m = req.method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      hygiene.nonGet.push({ test: currentTest, method: m, url: req.url().slice(0, 120) });
    }
    const buf = req.postDataBuffer();
    if (buf && buf.length) hygiene.bodies.push({ test: currentTest, method: m, url: req.url().slice(0, 120), bytes: buf.length, ctype: req.headers()['content-type'] || '' });
  });
  const onPage = (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') hygiene.consoleErrors.push({ test: currentTest, expected: expectErrors, text: msg.text().slice(0, 300) });
    });
    page.on('pageerror', (err) => hygiene.pageErrors.push({ test: currentTest, expected: false, text: String((err && err.stack) || err).slice(0, 400) }));
  };
  ctx.on('page', onPage);
  for (const p of ctx.pages()) onPage(p);
}

export async function openApp(ctx, { init } = {}) {
  instrument(ctx);
  const page = await ctx.newPage();
  // Vox-Slice is free for everyone (FREE_FOR_ALL in src/tier.js), so no tier trick is needed: the tests run
  // against the production build, served with the real _headers (npm run serve:dist).
  if (init) await page.addInitScript(init);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vox && window.__vox.ready === true, null, { timeout: 30000 });
  return page;
}

export const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

/** Wipe the IndexedDB transcript cache so the next transcription is real work.
 *  Never creates the database: a bare indexedDB.open would create an empty v1 DB without the store and
 *  silently break the app's own cache, so the upgrade is aborted when the DB does not exist yet. */
export async function clearCache(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const rq = indexedDB.open('vox-slice');
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (e) { /* ignore */ } };
    rq.onerror = () => resolve(false);
    rq.onsuccess = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('transcripts')) { db.close(); return resolve(true); }
      const tx = db.transaction('transcripts', 'readwrite');
      tx.objectStore('transcripts').clear();
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
  }));
}

/** Repair a profile whose vox-slice DB exists without its store (made by an earlier, broken version of clearCache). */
export async function repairProfile(ctx) {
  instrument(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + '/favicon.svg');
  const r = await page.evaluate(() => new Promise((resolve) => {
    const rq = indexedDB.open('vox-slice');
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (e) { /* ignore */ } resolve('none'); };
    rq.onerror = () => {};
    rq.onsuccess = () => {
      const db = rq.result; const has = db.objectStoreNames.contains('transcripts'); db.close();
      if (has) return resolve('ok');
      const d = indexedDB.deleteDatabase('vox-slice');
      d.onsuccess = () => resolve('deleted'); d.onerror = () => resolve('error'); d.onblocked = () => resolve('blocked');
    };
  }));
  await page.close();
  return r;
}

/** Choose files via the real file input. Entries are paths or {name,mimeType,buffer}. */
export async function chooseFiles(page, files) {
  await tid(page, 'file-input').setInputFiles(files);
}

/** Wait until n sources exist, every one has words, and the app is idle. */
export async function waitLoaded(page, n, timeout = 120000) {
  await page.waitForFunction((n) => {
    const s = window.__vox.state;
    return s.sources.length === n && s.sources.every((x) => x.words.length > 0) && !s.busy;
  }, n, { timeout, polling: 100 });
}

export async function loadAndWait(page, files, n = null, timeout = 120000) {
  const list = Array.isArray(files) ? files : [files];
  const t0 = Date.now();
  await chooseFiles(page, list);
  await waitLoaded(page, n ?? list.length, timeout);
  return Date.now() - t0;
}

export const sourceWords = (page, i = 0) => page.evaluate((i) => window.__vox.state.sources[i].words.map((w) => ({ text: w.text, start: w.start, end: w.end })), i);

/** Index of the first occurrence of a normalized token sequence at or after `from`, or -1. */
export function findSeq(words, seq, from = 0) {
  const toks = words.map((w) => normWords(w.text).join(''));
  for (let i = from; i + seq.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (toks[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

export function wordSpan(page, i) { return page.locator(`.transcript .w[data-i="${i}"]`); }

/** Select words i..j through real pointer interaction. */
export async function selectRange(page, i, j) {
  await wordSpan(page, i).click();
  if (j !== i) await wordSpan(page, j).click({ modifiers: ['Shift'] });
}
export async function makeClip(page, i, j, how = 'enter') {
  await selectRange(page, i, j);
  const before = await page.evaluate(() => window.__vox.state.clips.length);
  if (how === 'enter') await page.keyboard.press('Enter');
  else await tid(page, 'add-clip-btn').click();
  await page.waitForFunction((b) => window.__vox.state.clips.length === b + 1, before, { timeout: 5000 });
}
export async function setPad(page, ms) {
  await page.evaluate((ms) => {
    const el = document.querySelector('[data-testid="pad-input"]');
    el.value = String(ms); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
}

export async function downloadVia(page, action, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), action()]);
  const file = path.join(DL, name || dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename(), buf: readFileSync(file) };
}
export async function unzip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = new Map();
  for (const [n, f] of Object.entries(zip.files)) if (!f.dir) out.set(n, await f.async('nodebuffer'));
  return out;
}

// ---------------------------------------------------------------- audio parsing
export function parseWav(buf) {
  const r = { ok: false };
  if (buf.length < 44) return r;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return r;
  r.riffSize = buf.readUInt32LE(4);
  let p = 12; let fmt = null; let data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { data = { off: p + 8, size }; break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) return r;
  Object.assign(r, fmt, { dataSize: data.size, dataOff: data.off });
  r.sizeMatches = data.off + data.size === buf.length && r.riffSize === buf.length - 8;
  r.frames = data.size / (fmt.ch * fmt.bits / 8);
  r.duration = r.frames / fmt.sr;
  r.ok = fmt.tag === 1 && fmt.bits === 16;
  return r;
}
export function wavPeak(buf, w) {
  let peak = 0;
  for (let i = w.dataOff; i + 1 < w.dataOff + w.dataSize; i += 2) { const v = Math.abs(buf.readInt16LE(i)); if (v > peak) peak = v; }
  return peak / 32768;
}
const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SRT = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** Walk MPEG audio frames. Returns { ok, frames, duration, sr, id3 }. */
export function parseMp3(buf) {
  let p = 0; let id3 = false;
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'ID3') { id3 = true; p = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)); }
  const first = p;
  if (!(buf[p] === 0xff && (buf[p + 1] & 0xe0) === 0xe0)) return { ok: false, id3, reason: 'no sync at start' };
  let frames = 0; let samples = 0; let sr = 0;
  while (p + 4 <= buf.length) {
    if (!(buf[p] === 0xff && (buf[p + 1] & 0xe0) === 0xe0)) break;
    const ver = (buf[p + 1] >> 3) & 3; const layer = (buf[p + 1] >> 1) & 3;
    const bri = buf[p + 2] >> 4; const sri = (buf[p + 2] >> 2) & 3; const pad = (buf[p + 2] >> 1) & 1;
    if (layer !== 1 || ver === 1 || bri === 0 || bri === 15 || sri === 3) break;
    const mpeg1 = ver === 3; const kbps = BR[mpeg1 ? 1 : 2][bri]; sr = SRT[ver][sri];
    const spf = mpeg1 ? 1152 : 576;
    const len = Math.floor((mpeg1 ? 144 : 72) * kbps * 1000 / sr) + pad;
    if (len < 4) break;
    p += len; frames++; samples += spf;
  }
  return { ok: frames > 0, id3, frames, sr, duration: sr ? samples / sr : 0, trailing: buf.length - p, first };
}

export function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export async function shot(page, name, opts = {}) {
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file, ...opts });
  return file;
}

export function saveResults() {
  writeFileSync(path.join(OUT, `results-${BROWSER}.json`), JSON.stringify({
    base: BASE, when: new Date().toISOString(), results, metrics,
    hygiene: { consoleErrors: hygiene.consoleErrors, pageErrors: hygiene.pageErrors, hosts: Object.fromEntries(hygiene.hosts), bodies: hygiene.bodies, nonGet: hygiene.nonGet },
  }, null, 1));
}
