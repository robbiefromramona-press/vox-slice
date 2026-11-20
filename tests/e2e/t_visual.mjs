// Criteria 7 and 8: layout at desktop and phone widths, waveform editing, accessibility basics.
// Screenshots land in tests/out/shots for a human to look at.
import {
  check, info, openApp, loadAndWait, audio, tid, sourceWords, makeClip, findSeq, shot, launchFresh, wordSpan, sleep,
} from './lib.mjs';

/** Things that are wrong at any width. */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const vis = (e) => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
    const vw = document.documentElement.clientWidth;
    const out = { overflowX: document.documentElement.scrollWidth - vw, offRight: [], clipped: [], unnamed: [], small: [] };
    for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
      if (!vis(e) || e.closest('[hidden]')) continue;
      const r = e.getBoundingClientRect();
      const id = e.dataset.testid || e.id || e.getAttribute('aria-label') || e.dataset.act || (e.textContent || '').trim().slice(0, 24) || e.tagName;
      if (r.right > vw + 1 || r.left < -1) out.offRight.push(id);
      const name = [e.getAttribute('aria-label'), e.getAttribute('title'), e.labels && e.labels[0] && e.labels[0].textContent, e.textContent].map((x) => (x || '').trim()).find(Boolean) || '';
      if (!name) out.unnamed.push(id);
      if ((e.tagName === 'BUTTON' || e.getAttribute('role') === 'tab') && (r.width < 24 || r.height < 24)) out.small.push(`${id} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // button labels that are cut off
    for (const e of document.querySelectorAll('button span, .tab span, h2, .clip-text')) {
      if (!vis(e) || e.classList.contains('clip-text') || e.classList.contains('sr-only')) continue;
      if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') out.clipped.push((e.textContent || '').trim().slice(0, 24));
    }
    return out;
  });
}

async function reportLayout(page, label) {
  const p = await layoutProblems(page);
  check(`${label}: no sideways scrolling`, p.overflowX <= 1, `${p.overflowX} px wider than the screen`);
  check(`${label}: no control hangs off the edge`, p.offRight.length === 0, p.offRight.slice(0, 6).join(', '));
  check(`${label}: no button label is cut off`, p.clipped.length === 0, p.clipped.slice(0, 6).join(', '));
  check(`${label}: every control has an accessible name`, p.unnamed.length === 0, p.unnamed.slice(0, 6).join(', '));
  return p;
}

const overlaps = (a, b) => a && b && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

const desktop = {
  name: 'visual',
  async run({ getCtx }) {
    const ctx = await getCtx();
    const page = await openApp(ctx);
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      wordmark: getComputedStyle(document.querySelector('.fp-name, .tagline')).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
      failed: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
    }));
    info('fonts', { wordmark: fonts.wordmark, body: fonts.body, loaded: [...new Set(fonts.loaded)] });
    check('brand fonts load from the site itself (none failed)', fonts.failed.length === 0 && fonts.loaded.length >= 2, `${[...new Set(fonts.loaded)].join(', ')}; failed: ${fonts.failed.join(',')}`);
    check('page title and wordmark say Vox-Slice', (await page.title()) === 'Vox-Slice' && (await page.locator('h1.wordmark').getAttribute('aria-label')) === 'Vox-Slice');
    check('Fire-Press branding and the privacy promise are on the page', /Fire-Press/i.test(await page.locator('.fp-tag').innerText()) && /never leaves/i.test(await page.locator('.side-note').innerText()) && /Nothing is uploaded/i.test(await page.locator('.foot-privacy').innerText()));
    check('parody note is in the footer', /parody/i.test(await page.locator('.foot-note').innerText()));

    // ---- empty state
    check('empty state: drop zone shown, workspace and library hidden', (await tid(page, 'drop-zone').isVisible()) && !(await page.locator('#workspace').isVisible()) && !(await page.locator('#library').isVisible()));
    check('empty state: no "best on desktop Chrome" nag on desktop Chrome', await page.locator('#desktop-notice').isHidden());
    await shot(page, 'desktop-1-empty', { fullPage: true });
    await reportLayout(page, 'desktop empty');

    // ---- how-to toggles and remembers
    const body = page.locator('#howto-body');
    check('How-to is open on a first visit or as last left', (await body.isVisible()) || (await page.evaluate(() => localStorage.getItem('vox.howto'))) === 'closed');
    if (!(await body.isVisible())) await page.locator('.howto-head [data-howto-toggle]').click();
    await page.locator('.howto-head [data-howto-toggle]').click();
    check('How-to hides, and says so to assistive tech', !(await body.isVisible()) && (await page.locator('.howto-head [data-howto-toggle]').getAttribute('aria-expanded')) === 'false');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__vox && window.__vox.ready === true);
    check('How-to stays hidden after a reload', !(await body.isVisible()));
    await page.locator('.howto-head [data-howto-toggle]').click();
    check('How-to opens again', await body.isVisible());

    // ---- loaded
    await loadAndWait(page, audio('clean.wav'));
    const words = await sourceWords(page);
    await sleep(300);
    check('loaded: transcript, waveform, clips rack and export all on screen', (await tid(page, 'transcript').isVisible()) && (await tid(page, 'waveform').isVisible()) && (await tid(page, 'clips-list').count()) === 1 && (await tid(page, 'export-zip-btn').isVisible()));
    check('drop zone shrinks to its compact "add more" form', (await page.locator('.drop .only-compact').isVisible()) && !(await page.locator('.drop .only-big').isVisible()));
    const ink = await page.evaluate(() => {
      const c = document.querySelector('.wave-canvas'); const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data; let lit = 0; const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) { if (d[i + 3] > 20 && d[i] + d[i + 1] + d[i + 2] > 90) lit++; seen.add((d[i] >> 5) + '-' + (d[i + 1] >> 5) + '-' + (d[i + 2] >> 5)); }
      return { lit, total: d.length / 28, colors: seen.size, w: c.width, h: c.height };
    });
    check('waveform is actually drawn (not a blank canvas)', ink.lit / ink.total > 0.01 && ink.colors >= 3, `${(100 * ink.lit / ink.total).toFixed(1)}% lit, ${ink.colors} colour bands, ${ink.w}x${ink.h}`);
    check('waveform placeholder text is gone', await page.locator('#wave-empty').isHidden());

    // search field: the "/" hint must not sit on top of what you type
    const hint = await page.locator('.slash-hint').boundingBox();
    const inp = await tid(page, 'search-input').evaluate((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { right: r.right - parseFloat(s.paddingRight), left: r.left + parseFloat(s.paddingLeft) }; });
    const ico = await page.locator('.search .ico').first().boundingBox();
    check('search text area clears both the magnifier and the "/" hint', hint && hint.x >= inp.right - 1 && ico.x + ico.width <= inp.left + 1, `text ${Math.round(inp.left)}..${Math.round(inp.right)}, icon ends ${Math.round(ico.x + ico.width)}, hint starts ${Math.round(hint?.x)}`);

    // ---- selection + clips
    const i = Math.max(8, findSeq(words, ['thank', 'you', 'very', 'much']));
    await wordSpan(page, i).click();
    await wordSpan(page, i + 3).click({ modifiers: ['Shift'] });
    await sleep(400); // let the highlight fade in
    const selCss = await wordSpan(page, i + 1).evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, plain: getComputedStyle(e.parentElement.querySelector('.w:not(.sel)')).backgroundColor }));
    check('selected words look different from the rest', selCss.bg !== selCss.plain, `${selCss.bg} vs ${selCss.plain}`);
    check('selection summary names the words', /4 words selected/.test(await page.locator('#sel-info').innerText()), await page.locator('#sel-info').innerText());
    await sleep(400);
    await shot(page, 'desktop-2-selection');
    await page.keyboard.press('Enter');
    for (const w of ['bridge', 'library', 'bakery', 'river']) { const k = findSeq(words, [w]); if (k >= 0) await makeClip(page, k, k); }
    const nClips = await page.evaluate(() => window.__vox.state.clips.length);
    check('words that are in a clip are marked in the transcript', (await page.locator('.transcript .w.inclip').count()) >= 4 + nClips - 1);
    await tid(page, 'search-input').fill('our');
    await page.waitForFunction(() => window.__vox.state.matches.length > 0);
    check('search hits are highlighted in the transcript and listed', (await page.locator('.transcript .w.hit').count()) === (await page.evaluate(() => window.__vox.state.matches.length)) && (await page.locator('#search-results .res-item').count()) > 0);
    await shot(page, 'desktop-3-search-clips', { fullPage: true });
    await tid(page, 'search-input').fill('');
    await reportLayout(page, 'desktop loaded');
    const cardOver = await page.locator('.clip').first().evaluate((c) => [...c.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).length);
    check('clip card buttons all fit inside the card', cardOver === 0, `${cardOver} outside`);

    // ---- waveform: drag a handle
    const first = page.locator('.clip').first();
    await first.locator('.clip-text').click();
    await sleep(700); // focusRegion animation
    const geo = async () => page.evaluate(() => { const wf = window.__voxWf; const r = wf.canvas.getBoundingClientRect(); const c = window.__vox.state.clips.find((x) => x.id === window.__vox.state.selClipId); return { v: wf.view, x: r.left, y: r.top, w: r.width, h: r.height, start: c.start, end: c.end }; });
    let g = await geo();
    const xOf = (t) => g.x + ((t - g.v[0]) / (g.v[1] - g.v[0])) * g.w;
    check('selecting a clip zooms the waveform to it', g.v[0] <= g.start && g.v[1] >= g.end && (g.v[1] - g.v[0]) < 6, `view ${g.v[0].toFixed(2)}..${g.v[1].toFixed(2)} for clip ${g.start.toFixed(2)}..${g.end.toFixed(2)}`);
    const secPerPx = (g.v[1] - g.v[0]) / g.w;
    const y = g.y + g.h * 0.45;
    await page.mouse.move(xOf(g.end) + 3, y);
    check('cursor shows the handle can be dragged', (await page.evaluate(() => window.__voxWf.canvas.style.cursor)) === 'col-resize');
    await page.mouse.down();
    await page.mouse.move(xOf(g.end) + 43, y, { steps: 8 });
    const mid = await geo();
    await page.mouse.up();
    let g2 = await geo();
    check('dragging the end handle right makes the clip longer by the distance dragged', Math.abs((g2.end - g.end) - 40 * secPerPx) < 2.5 * secPerPx && g2.start === g.start, `${((g2.end - g.end) * 1000).toFixed(0)} ms for 40 px (${(40 * secPerPx * 1000).toFixed(0)} ms expected)`);
    check('the clip updates live while dragging, not only on release', mid.end > g.end);
    const durTxt = await first.locator('[data-f="dur"]').innerText();
    check('the clip card shows the new length', durTxt === (g2.end - g2.start).toFixed(3) + ' s', durTxt);
    g = await geo();
    await page.mouse.move(xOf(g.start) - 3, y);
    await page.mouse.down();
    await page.mouse.move(xOf(g.start) - 33, y, { steps: 6 });
    await page.mouse.up();
    g2 = await geo();
    check('dragging the start handle left starts the clip earlier', Math.abs((g.start - g2.start) - 30 * secPerPx) < 2.5 * secPerPx && g2.end === g.end, `${((g.start - g2.start) * 1000).toFixed(0)} ms`);
    // a handle can not be dragged through the other one
    g = await geo();
    await page.mouse.move(xOf(g.end) + 3, y);
    await page.mouse.down();
    await page.mouse.move(xOf(g.start) - 80, y, { steps: 10 });
    await page.mouse.up();
    g2 = await geo();
    check('the end handle can not be dragged past the start', g2.end >= g2.start + 0.02 - 1e-9 && g2.start === g.start, `${g2.start.toFixed(3)}..${g2.end.toFixed(3)}`);
    await shot(page, 'desktop-4-waveform-clip');

    // ---- waveform: zoom, fit, click to play
    await page.locator('#zoom-fit-btn').click();
    await sleep(500);
    const dur = await page.evaluate(() => window.__voxWf.duration);
    let v = await page.evaluate(() => window.__voxWf.view);
    check('Fit shows the whole file', v[0] < 0.01 && Math.abs(v[1] - dur) < 0.01, v.map((x) => x.toFixed(2)).join('..'));
    await page.locator('#zoom-in-btn').click(); await sleep(450);
    const v1 = await page.evaluate(() => window.__voxWf.view);
    check('Zoom in halves the visible span', Math.abs((v1[1] - v1[0]) - dur / 2) < dur * 0.03, `${(v1[1] - v1[0]).toFixed(2)} s of ${dur.toFixed(2)} s`);
    await page.locator('#zoom-out-btn').click(); await sleep(450);
    v = await page.evaluate(() => window.__voxWf.view);
    check('Zoom out brings it back', Math.abs((v[1] - v[0]) - dur) < dur * 0.03);
    g = await geo();
    await page.mouse.move(g.x + g.w * 0.5, y);
    const sy0 = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -400); await sleep(450);
    const v2 = await page.evaluate(() => window.__voxWf.view);
    check('mouse wheel zooms in around the pointer', (v2[1] - v2[0]) < dur * 0.7 && v2[0] < dur * 0.5 && v2[1] > dur * 0.5, v2.map((x) => x.toFixed(2)).join('..'));
    check('wheel over the waveform does not scroll the page', (await page.evaluate(() => window.scrollY)) === sy0);
    await page.locator('#zoom-sel-btn').click(); await sleep(500);
    v = await page.evaluate(() => window.__voxWf.view);
    g = await geo();
    check('"Zoom to clip" returns to the selected clip', v[0] <= g.start && v[1] >= g.end && (v[1] - v[0]) < 6);
    await page.keyboard.press('Escape');
    await page.locator('#zoom-fit-btn').click(); await sleep(500);
    g = await geo().catch(() => null);
    const box = await page.evaluate(() => { const r = window.__voxWf.canvas.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.click(box.x + box.w * 0.9, box.y + box.h * 0.4);
    await page.waitForFunction(() => !!document.querySelector('.transcript .w.playing'), null, { timeout: 3000 }).catch(() => {});
    const playingIdx = await page.locator('.transcript .w.playing').evaluateAll((els) => els.map((e) => +e.dataset.i));
    check('clicking the waveform plays from that point (the matching word lights up)', playingIdx.length === 1 && words[playingIdx[0]].start > dur * 0.8, `word ${playingIdx[0]} of ${words.length}`);
    await page.locator('#stop-btn').click();
    check('Stop button stops playback', (await page.locator('.transcript .w.playing').count()) === 0);

    // ---- transcription in progress (the look while it works)
    await page.close();
    const { browser, ctx: fresh } = await launchFresh();
    try {
      const p2 = await openApp(fresh);
      await tid(p2, 'file-input').setInputFiles(audio('clean.wav'));
      await p2.waitForFunction(() => !document.querySelector('[data-testid=progress]').hidden, null, { timeout: 30000 });
      const lbl0 = await p2.locator('[data-testid=progress] .prog-label').innerText();
      check('progress panel appears straight away with a plain-language label', lbl0.length > 3 && !/undefined|NaN|null/.test(lbl0), lbl0);
      check('Cancel button is offered while working', await tid(p2, 'cancel-btn').isVisible());
      const labels = new Set([lbl0]);
      const t0 = Date.now(); let shotDone = false; let sawBusyBlock = true;
      while (Date.now() - t0 < 300000) {
        const st = await p2.evaluate(() => ({ busy: window.__vox.state.busy, hidden: document.querySelector('[data-testid=progress]').hidden, label: document.querySelector('[data-testid=progress] .prog-label').textContent, detail: document.querySelector('[data-testid=progress] .prog-detail').textContent, zip: document.querySelector('[data-testid=export-zip-btn]').disabled, n: window.__vox.state.sources[0] ? window.__vox.state.sources[0].words.length : 0 }));
        if (!st.busy) break;
        if (st.label) labels.add(st.label.replace(/\d+ of \d+ MB/, 'N of M MB'));
        if (!st.zip) sawBusyBlock = false;
        if (!shotDone && st.n > 20) { await shot(p2, 'desktop-5-transcribing'); shotDone = true; }
        await sleep(150);
      }
      info('progress labels seen', [...labels]);
      check('progress labels never show raw junk', [...labels].every((l) => !/undefined|NaN|null|\[object/.test(l)), [...labels].join(' | '));
      check('first-run model download is announced as a one-off', [...labels].some((l) => /first time only/i.test(l)), [...labels].join(' | '));
      check('export stays disabled while the app is busy', sawBusyBlock);
      check('progress panel goes away when finished', await tid(p2, 'progress').isHidden());
      await p2.close();
    } finally { await fresh.close(); await browser.close(); }
  },
};

const builderView = {
  name: 'visual-builder',
  async run({ getCtx }) {
    const ctx = await getCtx();
    const page = await openApp(ctx);
    await loadAndWait(page, audio('clean.wav'));
    await tid(page, 'tab-builder').click();
    await shot(page, 'desktop-6-builder-empty');
    check('builder explains itself before anything is built', await page.locator('#builder-empty').isVisible());
    await tid(page, 'builder-input').fill('thank you very much\nour bridge is tremendous\nevery voice matters tonight');
    await tid(page, 'builder-run-btn').click();
    await sleep(200);
    await shot(page, 'desktop-7-builder-built', { fullPage: true });
    await reportLayout(page, 'desktop builder');
    const mc = await page.locator('.bchip.missing').first().evaluate((e) => getComputedStyle(e).borderColor + '|' + getComputedStyle(e).color).catch(() => '');
    const fc = await page.locator('.bchip.found').first().evaluate((e) => getComputedStyle(e).borderColor + '|' + getComputedStyle(e).color);
    check('missing chips look different from found chips', mc !== '' && mc !== fc, `${mc} vs ${fc}`);
    await page.close();
  },
};

const phone = {
  name: 'visual-phone',
  async run() {
    const { browser, ctx: base } = await launchFresh();
    await base.close();
    const ctx = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, httpCredentials: process.env.VOX_USER ? { username: process.env.VOX_USER, password: process.env.VOX_PASS || '' } : undefined });
    try {
      const page = await openApp(ctx);
      await page.evaluate(() => document.fonts.ready);
      check('phone: the "works best on desktop Chrome" notice is shown', await page.locator('#desktop-notice').isVisible());
      await shot(page, 'phone-1-empty', { fullPage: true });
      await reportLayout(page, 'phone empty');
      const wm = await page.locator('h1.wordmark').boundingBox();
      check('phone: wordmark fits the screen', wm && wm.x >= 0 && wm.x + wm.width <= 376, wm ? `${Math.round(wm.x)}..${Math.round(wm.x + wm.width)}` : 'missing');
      await page.locator('#desktop-notice button').tap();
      check('phone: notice can be dismissed', await page.locator('#desktop-notice').isHidden());
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__vox && window.__vox.ready === true);
      check('phone: dismissed notice stays dismissed', await page.locator('#desktop-notice').isHidden());

      await tid(page, 'file-input').setInputFiles(audio('clean.wav'));
      await page.waitForFunction(() => { const s = window.__vox.state; return s.sources.length === 1 && s.sources[0].words.length > 0 && !s.busy; }, null, { timeout: 420000, polling: 200 });
      const words = await sourceWords(page);
      await sleep(300);
      await shot(page, 'phone-2-loaded', { fullPage: true });
      const p = await reportLayout(page, 'phone loaded');
      info('phone: buttons under 24 px', p.small);
      check('phone: no button smaller than 24 px', p.small.length === 0, p.small.slice(0, 6).join(', '));

      // tap selects, tap on Add clip adds
      const i = Math.max(5, findSeq(words, ['bridge']));
      await wordSpan(page, i).scrollIntoViewIfNeeded();
      await wordSpan(page, i).tap();
      let sel = await page.evaluate(() => window.__vox.state.sel && [window.__vox.state.sel.a, window.__vox.state.sel.b]);
      check('phone: tapping a word selects it', sel && sel[0] === i && sel[1] === i, JSON.stringify(sel));
      await page.locator('#sel-extend-btn').tap(); await page.locator('#sel-extend-btn').tap();
      sel = await page.evaluate(() => window.__vox.state.sel && [window.__vox.state.sel.a, window.__vox.state.sel.b]);
      check('phone: the + button extends the selection (no keyboard needed)', sel && sel[0] === i && sel[1] === i + 2, JSON.stringify(sel));
      await tid(page, 'add-clip-btn').tap();
      check('phone: Add clip works by touch', (await page.evaluate(() => window.__vox.state.clips.length)) === 1);
      await page.locator('.clip').first().scrollIntoViewIfNeeded();
      await sleep(300);
      await shot(page, 'phone-3-clip');
      const card = await page.locator('.clip').first().boundingBox();
      check('phone: clip card fits the screen width', card && card.x >= 0 && card.x + card.width <= 376, card ? `${Math.round(card.width)} px wide` : '');
      const acts = await page.locator('.clip').first().locator('.clip-acts button').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      let clash = 0; for (let a = 0; a < acts.length; a++) for (let b = a + 1; b < acts.length; b++) if (overlaps(acts[a], acts[b])) clash++;
      check('phone: clip buttons do not overlap each other', clash === 0, `${clash} overlapping pairs`);
      const dl = page.waitForEvent('download', { timeout: 60000 }).then((d) => d.suggestedFilename()).catch(() => null);
      await tid(page, 'export-zip-btn').scrollIntoViewIfNeeded();
      await tid(page, 'export-zip-btn').tap();
      const name = await dl;
      check('phone: export downloads the ZIP', name === 'clean_vox-slice.zip', String(name));

      await tid(page, 'tab-builder').tap();
      await tid(page, 'builder-input').fill('thank you very much\nour bridge is tremendous');
      await tid(page, 'builder-run-btn').tap();
      await sleep(200);
      await shot(page, 'phone-4-builder', { fullPage: true });
      await reportLayout(page, 'phone builder');
      await page.close();
    } finally { await ctx.close(); await browser.close(); }
  },
};

const a11y = {
  name: 'a11y',
  async run({ getCtx }) {
    const ctx = await getCtx();
    const page = await openApp(ctx);
    await loadAndWait(page, audio('clean.wav'));
    const words = await sourceWords(page);
    await makeClip(page, 4, 6);
    await sleep(900); // the new card animates in; measure it at rest
    const r = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lum = (c) => { const m = rgba(c); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return { L: 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), a: m[3] == null ? 1 : m[3] }; };
      const relL = (m) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      // Stack the see-through panel colours over the page's base colour. The page-wide backdrop glow is treated as the base colour.
      const bgOf = (e) => { const layers = []; for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0.01) layers.push(c); if (c[3] > 0.99) break; } let o = [10, 10, 15]; for (const c of layers.reverse()) o = [0, 1, 2].map((k) => c[k] * c[3] + o[k] * (1 - c[3])); return relL(o); };
      const low = [];
      const skipped = new Set();
      const seen = new Set();
      for (const e of document.querySelectorAll('p, span, b, h1, h2, h3, button, label, li, td, th, small, output, kbd, legend, option')) {
        if (!e.getClientRects().length || e.closest('[hidden]') || e.closest('[aria-hidden=true]')) continue;
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!own) continue;
        const s = getComputedStyle(e);
        if (+s.opacity < 0.1 || s.visibility === 'hidden') continue;
        if (e.disabled || e.closest('button:disabled')) continue; // disabled controls are exempt
        const fg = lum(s.color); if (fg.a < 0.9) continue;
        // text on a gradient or picture can not be measured from one colour: note it and move on
        let grad = false; for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage !== 'none') { grad = true; break; } if (rgba(cs.backgroundColor)[3] > 0.99) break; }
        if (grad) { skipped.add((e.textContent || '').trim().slice(0, 24)); continue; }
        let op = 1; for (let n = e; n; n = n.parentElement) op *= +getComputedStyle(n).opacity;
        const bg = bgOf(e);
        const fgL = fg.L * op + bg * (1 - op);
        const ratio = (Math.max(fgL, bg) + 0.05) / (Math.min(fgL, bg) + 0.05);
        const size = parseFloat(s.fontSize); const big = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
        if (ratio < (big ? 3 : 4.5)) { const key = (e.className || e.tagName) + '|' + s.color; if (!seen.has(key)) { seen.add(key); low.push(`${(e.textContent || '').trim().slice(0, 28)} (${ratio.toFixed(2)}, ${Math.round(size)}px)`); } }
      }
      const live = ['status', 'match-count'].map((id) => document.querySelector(`[data-testid=${id}]`).getAttribute('aria-live'));
      return {
        low,
        skipped: [...skipped],
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        live,
        alert: document.querySelector('[data-testid=error-banner]').getAttribute('role'),
        tablist: document.querySelector('.tools').getAttribute('role'),
        panels: [...document.querySelectorAll('[role=tabpanel]')].map((p) => p.getAttribute('aria-labelledby')),
        progress: document.querySelector('[data-testid=progress] [role=progressbar]') != null,
        canvasLabel: document.querySelector('.wave-canvas').getAttribute('aria-label'),
        imgsNoAlt: [...document.querySelectorAll('img:not([alt])')].length,
        svgsExposed: [...document.querySelectorAll('svg')].filter((s) => s.getAttribute('aria-hidden') !== 'true' && !s.getAttribute('aria-label') && s.getClientRects().length).length,
      };
    });
    info('low-contrast text', r.low);
    info('text on gradients (not measured, check by eye)', r.skipped);
    check('text contrast meets WCAG AA (4.5:1, or 3:1 for large text)', r.low.length === 0, r.low.slice(0, 8).join(' ; '));
    check('page has a language, one h1, and no unlabeled images or icons', r.lang === 'en' && r.h1 === 1 && r.imgsNoAlt === 0 && r.svgsExposed === 0, JSON.stringify({ lang: r.lang, h1: r.h1, img: r.imgsNoAlt, svg: r.svgsExposed }));
    check('status line and match count are announced politely; errors are alerts', r.live.every((x) => x === 'polite') && r.alert === 'alert', JSON.stringify(r.live));
    check('tabs, panels, progress bar and waveform carry roles / labels', r.tablist === 'tablist' && r.panels.join() === 'tab-slice,tab-builder' && r.progress && /waveform/i.test(r.canvasLabel));

    // keyboard-only: everything reachable, focus always visible
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const stops = []; let invisible = 0; const noRing = [];
    for (let k = 0; k < 90; k++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return null;
        const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
        const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
        return { id: e.dataset.testid || e.id || e.dataset.act || e.getAttribute('aria-label') || e.className || e.tagName, w: r.width, h: r.height, ring, hiddenInput: e.tagName === 'INPUT' && (e.type === 'file' || e.type === 'checkbox' || e.type === 'range') };
      });
      if (!f) continue;
      if (stops.includes(f.id) && stops.length > 25 && f.id === stops[0]) break;
      stops.push(f.id);
      if (f.w < 1 || f.h < 1) { if (!f.hiddenInput) invisible++; }
      else if (!f.ring && !f.hiddenInput) noRing.push(f.id);
    }
    info('tab stops', stops.length);
    const need = ['tab-slice', 'drop-zone', 'search-input', 'pad-input', 'fmt-wav', 'export-zip-btn', 'save-project-btn'];
    const missing = need.filter((n) => !stops.includes(n));
    check('Tab key reaches every main control', missing.length === 0, `missing: ${missing.join(', ')} (of ${stops.length} stops)`);
    check('keyboard focus never lands on something invisible', invisible === 0, `${invisible}`);
    check('every focused control shows a focus ring', noRing.length === 0, [...new Set(noRing)].slice(0, 8).join(', '));

    // reduced motion is honoured
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const anim = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return e.getClientRects().length && s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.05 && s.animationIterationCount === 'infinite'; }).map((e) => e.className || e.tagName).slice(0, 5));
    check('"reduce motion" setting stops the looping animations', anim.length === 0, anim.join(', '));
    await page.emulateMedia({ reducedMotion: null });
    void words;
    await page.close();
  },
};

export const tests = [desktop, builderView, phone, a11y];
