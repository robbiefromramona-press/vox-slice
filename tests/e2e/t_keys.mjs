// Criterion 6: every keyboard shortcut in the How-to table does what it says, and none fire while typing.
import { check, info, openApp, loadAndWait, audio, tid, sourceWords, wordSpan, findSeq } from './lib.mjs';

const S = (page) => page.evaluate(() => {
  const s = window.__vox.state;
  return {
    sel: s.sel && { a: s.sel.a, b: s.sel.b },
    selClip: s.selClipId,
    loop: s.loopClipId,
    clips: s.clips.map((c) => ({ id: c.id, start: c.start, end: c.end, i0: c.i0, i1: c.i1 })),
    matches: s.matches.length,
    playBtn: document.querySelector('[data-testid=play-sel-btn] span').textContent,
    focus: document.activeElement && (document.activeElement.dataset.testid || document.activeElement.id || document.activeElement.tagName),
  };
});
const near = (a, b, tol = 0.0005) => Math.abs(a - b) <= tol;

export const tests = [{
  name: 'keys',
  async run({ getCtx }) {
    const ctx = await getCtx();
    const page = await openApp(ctx);

    // the table in the How-to panel is the contract
    const table = await page.locator('.keys tr').evaluateAll((rows) => rows.map((r) => [[...r.querySelectorAll('kbd')].map((k) => k.textContent).join(' '), r.querySelector('td').textContent]));
    info('documented shortcuts', table.map((r) => r[0]).join(' | '));
    check('How-to lists the 9 shortcut rows', table.length === 9, `${table.length}`);

    // nothing loaded: keys must be harmless
    for (const k of ['Space', 'Enter', 'l', 'ArrowRight', '[', ']', ';', "'", 'Delete', 'Escape']) await page.keyboard.press(k);
    let s = await S(page);
    check('with nothing loaded, shortcuts do nothing and raise no error', s.clips.length === 0 && !s.sel && !(await tid(page, 'error-banner').isVisible()));

    await loadAndWait(page, audio('clean.wav'));
    const words = await sourceWords(page);
    const dur = await page.evaluate(() => window.__vox.state.sources[0].duration);
    const i = Math.max(12, findSeq(words, ['bridge']));

    // ---- arrows
    await wordSpan(page, i).click();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    s = await S(page);
    check('Right arrow extends the selection end by a word each press', s.sel && s.sel.a === i && s.sel.b === i + 2, JSON.stringify(s.sel));
    await page.keyboard.press('ArrowLeft');
    s = await S(page);
    check('Left arrow shrinks the selection end by a word', s.sel && s.sel.a === i && s.sel.b === i + 1, JSON.stringify(s.sel));
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    s = await S(page);
    check('Left arrow never shrinks below one word', s.sel && s.sel.a === i && s.sel.b === i, JSON.stringify(s.sel));
    await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft');
    s = await S(page);
    check('Shift+Left moves the start earlier', s.sel && s.sel.a === i - 2 && s.sel.b === i, JSON.stringify(s.sel));
    await page.keyboard.press('Shift+ArrowRight');
    s = await S(page);
    check('Shift+Right moves the start later', s.sel && s.sel.a === i - 1 && s.sel.b === i, JSON.stringify(s.sel));
    const painted = await page.locator('.transcript .w.sel').evaluateAll((els) => els.map((e) => +e.dataset.i));
    check('highlight in the transcript follows the keyboard selection', JSON.stringify(painted) === JSON.stringify([i - 1, i]), painted.join(','));
    // clamp at the end of the file
    await wordSpan(page, words.length - 1).click();
    await page.keyboard.press('ArrowRight');
    s = await S(page);
    check('Right arrow stops at the last word', s.sel && s.sel.b === words.length - 1 && s.sel.a === words.length - 1, JSON.stringify(s.sel));
    await wordSpan(page, 0).click();
    await page.keyboard.press('Shift+ArrowLeft');
    s = await S(page);
    check('Shift+Left stops at the first word', s.sel && s.sel.a === 0 && s.sel.b === 0, JSON.stringify(s.sel));

    // ---- space: play / stop the selection
    await wordSpan(page, i).click();
    await wordSpan(page, i + 12).click({ modifiers: ['Shift'] });
    const y0 = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');
    s = await S(page);
    check('Space plays the selection', s.playBtn === 'Stop', s.playBtn);
    await page.waitForFunction(() => !!document.querySelector('.transcript .w.playing'), null, { timeout: 3000 }).catch(() => {});
    check('the word being spoken is highlighted while it plays', (await page.locator('.transcript .w.playing').count()) === 1);
    await page.keyboard.press('Space');
    s = await S(page);
    check('Space again stops it', s.playBtn === 'Play selection', s.playBtn);
    const y1 = await page.evaluate(() => window.scrollY);
    check('Space did not scroll the page', y1 === y0, `${y0} -> ${y1}`);

    // ---- escape: stop first, then clear
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    s = await S(page);
    check('Esc while playing stops playback but keeps the selection', s.playBtn === 'Play selection' && !!s.sel, JSON.stringify(s.sel));
    await page.keyboard.press('Escape');
    s = await S(page);
    check('Esc again clears the selection', s.sel === null);
    check('Add clip is disabled with no selection', await tid(page, 'add-clip-btn').isDisabled());
    await page.keyboard.press('Enter');
    s = await S(page);
    check('Enter with no selection adds nothing', s.clips.length === 0);

    // ---- enter: add clip
    await wordSpan(page, i).click();
    await wordSpan(page, i + 2).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Enter');
    s = await S(page);
    check('Enter adds the selection as a clip and selects it', s.clips.length === 1 && s.selClip === s.clips[0].id && s.clips[0].i0 === i && s.clips[0].i1 === i + 2 && s.sel === null, JSON.stringify(s.clips));
    const id = s.clips[0].id;
    const c0 = s.clips[0];
    check('the new clip card is marked selected', await page.locator(`.clip[data-clip-id="${id}"]`).evaluate((e) => e.classList.contains('sel')));

    // ---- nudges
    await page.keyboard.press('[');
    s = await S(page);
    check('[ moves the clip start 10 ms earlier', near(s.clips[0].start, c0.start - 0.01) && near(s.clips[0].end, c0.end), `${s.clips[0].start} vs ${c0.start}`);
    await page.keyboard.press(']'); await page.keyboard.press(']');
    s = await S(page);
    check('] moves the clip start 10 ms later', near(s.clips[0].start, c0.start + 0.01), `${s.clips[0].start}`);
    await page.keyboard.press(';');
    s = await S(page);
    check('; moves the clip end 10 ms earlier', near(s.clips[0].end, c0.end - 0.01) && near(s.clips[0].start, c0.start + 0.01), `${s.clips[0].end} vs ${c0.end}`);
    await page.keyboard.press("'"); await page.keyboard.press("'");
    s = await S(page);
    check("' moves the clip end 10 ms later", near(s.clips[0].end, c0.end + 0.01), `${s.clips[0].end}`);
    const shown = await page.locator(`.clip[data-clip-id="${id}"] [data-f="dur"]`).innerText();
    check('the card shows the nudged length', shown === (s.clips[0].end - s.clips[0].start).toFixed(3) + ' s', shown);
    // edges can never cross or leave the file
    for (let k = 0; k < 400; k++) await page.keyboard.press(']');
    s = await S(page);
    check('start can never pass the end (stays at least 20 ms short)', s.clips[0].start <= s.clips[0].end - 0.02 + 1e-9 && s.clips[0].start > c0.start, `${s.clips[0].start.toFixed(3)} .. ${s.clips[0].end.toFixed(3)}`);
    await page.locator(`.clip[data-clip-id="${id}"] [data-act="start-"]`).click({ modifiers: ['Shift'] });
    const s2 = await S(page);
    check('Shift+click on a nudge button moves 50 ms', near(s2.clips[0].start, s.clips[0].start - 0.05), `${((s.clips[0].start - s2.clips[0].start) * 1000).toFixed(1)} ms`);

    // ---- space with a clip selected, L loop
    await page.locator(`.clip[data-clip-id="${id}"] .clip-text`).click();
    await page.keyboard.press('Space');
    check('Space plays the selected clip', (await page.locator(`.clip[data-clip-id="${id}"] [data-act="play"] span`).innerText()) === 'Stop');
    await page.keyboard.press('Space');
    check('Space stops the clip', (await page.locator(`.clip[data-clip-id="${id}"] [data-act="play"] span`).innerText()) === 'Play');
    await page.keyboard.press('l');
    s = await S(page);
    check('L starts looping the selected clip', s.loop === id && (await page.locator(`.clip[data-clip-id="${id}"] [data-act="loop"]`).getAttribute('aria-pressed')) === 'true');
    await page.waitForTimeout(700); // longer than the clip: it must still be looping
    s = await S(page);
    check('the loop keeps going past the end of the clip', s.loop === id);
    await page.keyboard.press("'");
    s = await S(page);
    check('nudging an edge keeps the loop running', s.loop === id);
    await page.keyboard.press('L');
    s = await S(page);
    check('L again stops the loop', s.loop === null && (await page.locator(`.clip[data-clip-id="${id}"] [data-act="loop"]`).getAttribute('aria-pressed')) === 'false');

    // ---- / jumps to search; typing never triggers shortcuts
    await page.locator(`.clip[data-clip-id="${id}"] .clip-text`).click();
    const beforeType = (await S(page)).clips[0];
    await page.keyboard.press('/');
    s = await S(page);
    check('/ jumps to the search box', s.focus === 'search-input', String(s.focus));
    check('/ is not typed into the box', (await tid(page, 'search-input').inputValue()) === '');
    await page.keyboard.type("l [ ] ; ' our");
    await page.keyboard.press('Delete');
    await page.keyboard.press('Space');
    s = await S(page);
    check('typing in search never fires shortcuts (clip untouched, no loop, nothing playing)', s.clips.length === 1 && near(s.clips[0].start, beforeType.start, 1e-9) && near(s.clips[0].end, beforeType.end, 1e-9) && s.loop === null && s.playBtn === 'Play selection', JSON.stringify(s.clips[0]));
    await tid(page, 'search-input').fill('our');
    await page.waitForFunction(() => window.__vox.state.matches.length > 0, null, { timeout: 5000 });
    await page.keyboard.press('Enter');
    s = await S(page);
    const first = await page.evaluate(() => window.__vox.state.matches[0].i0);
    check('Enter in search jumps to the first match (and adds no clip)', s.sel && s.sel.a === first && s.clips.length === 1, JSON.stringify(s.sel));
    await page.keyboard.press('Enter');
    s = await S(page);
    const second = await page.evaluate(() => window.__vox.state.matches[1].i0);
    check('Enter again steps to the next match', s.sel && s.sel.a === second, JSON.stringify(s.sel));
    await page.keyboard.press('Escape');
    s = await S(page);
    check('Esc in search clears the search and leaves the box', (await tid(page, 'search-input').inputValue()) === '' && s.matches === 0 && s.focus !== 'search-input', String(s.focus));

    // ---- delete removes the selected clip
    await page.locator(`.clip[data-clip-id="${id}"] .clip-text`).click();
    await page.keyboard.press('Delete');
    s = await S(page);
    check('Delete removes the selected clip', s.clips.length === 0 && s.selClip === null);
    await page.keyboard.press('Delete');
    check('Delete with nothing selected is harmless', (await S(page)).clips.length === 0 && !(await tid(page, 'error-banner').isVisible()));

    // ---- shortcuts stay out of the way of focused buttons and the Builder tab
    await wordSpan(page, i).click();
    await tid(page, 'add-clip-btn').focus();
    await page.keyboard.press('Enter');
    s = await S(page);
    check('Enter on the focused Add clip button adds exactly one clip (no double fire)', s.clips.length === 1, `${s.clips.length}`);
    await wordSpan(page, i + 5).click();
    await tid(page, 'tab-builder').click();
    await page.locator('#view-builder h2').first().click();
    await page.keyboard.press('Enter'); await page.keyboard.press('Delete'); await page.keyboard.press('Space');
    s = await S(page);
    check('Slice shortcuts are off while the Builder tab is showing', s.clips.length === 1 && s.playBtn === 'Play selection', `${s.clips.length} clips`);

    // ---- tabs are a proper keyboard tablist
    await tid(page, 'tab-builder').focus();
    await page.keyboard.press('ArrowLeft');
    const t1 = await page.evaluate(() => ({ slice: document.querySelector('[data-testid=tab-slice]').getAttribute('aria-selected'), vis: !document.getElementById('view-slice').hidden, focus: document.activeElement.dataset.testid }));
    check('arrow keys move between the Slice and Builder tabs', t1.slice === 'true' && t1.vis && t1.focus === 'tab-slice', JSON.stringify(t1));

    // ---- drop zone opens the file picker from the keyboard
    const zone = tid(page, 'drop-zone');
    await zone.focus();
    // The filechooser event may take a moment to register after Enter in
    // headless Chromium; wait up to 5 s, then fall back to a failed check.
    const chooser = await Promise.race([
      page.waitForEvent('filechooser', { timeout: 5000 }).then(() => true).catch(() => false),
      page.waitForTimeout(5000).then(() => false),
    ]);
    await page.keyboard.press('Enter');
    check('Enter on the drop zone opens the file picker', await chooser);
    info('file duration (s)', dur);
    await page.close();
  },
}];
