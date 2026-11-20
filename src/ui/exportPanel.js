// Export panel (ZIP) and project save/load.
import { exportClips, makeZip } from '../encode.js';
import { packFileName } from '../phrases.js';
import { serializeProject, parseProject } from '../store.js';
import { state, meta, on, emit, getSource, activeSource, setBusy, setStatus, setActive, uid } from './state.js';
import { tid, el, clear, saveBlob, baseName, pluralise } from './dom.js';
import { showError } from './notices.js';

let zipBtn, result, progWrap, progFill, progText;

function formats() {
  const f = [];
  if (tid('fmt-wav').checked) f.push('wav');
  if (tid('fmt-mp3').checked) f.push('mp3');
  return f;
}

function refresh() {
  const f = formats();
  const n = state.clips.length;
  zipBtn.disabled = !n || !f.length || state.busy;
  const hint = document.getElementById('export-hint');
  if (!n) hint.textContent = 'Add a few clips first, then they can ride out in a ZIP.';
  else if (!f.length) hint.textContent = 'Tick at least one format (WAV or MP3).';
  else {
    const unlinked = state.clips.filter((c) => !getSource(c.sourceId)?.buffer).length;
    hint.textContent = unlinked
      ? `${pluralise(n - unlinked, 'clip')} ready. ${pluralise(unlinked, 'clip')} will be skipped until you relink the audio.`
      : `${pluralise(n, 'clip')} ready. A manifest.csv listing every file, source and timing is included.`;
  }
}

function zipName() {
  const custom = packFileName(state.settings.packName);
  if (custom) return custom;
  const ids = new Set(state.clips.map((c) => c.sourceId));
  if (ids.size === 1) {
    const s = getSource([...ids][0]);
    if (s) return `${baseName(s.name)}_vox-slice.zip`;
  }
  return 'vox-slice-clips.zip';
}

// A small, dismissible thank-you line after a finished export. The download has already started: this never blocks it.
function showKofiNudge() {
  const close = el('button', { type: 'button', 'aria-label': 'Dismiss', text: '×' });
  const line = el('p', { class: 'kofi-nudge', 'data-testid': 'kofi-nudge' }, [
    'Saved you some time? ',
    el('a', { href: 'https://ko-fi.com/robbiefromramona', target: '_blank', rel: 'noopener noreferrer', text: '☕ Buy me a coffee' }),
    close,
  ]);
  close.addEventListener('click', () => line.remove());
  result.append(line);
}

async function exportZip() {
  const f = formats();
  if (!state.clips.length || !f.length) return;
  setBusy('export', true);
  zipBtn.disabled = true;
  progWrap.hidden = false;
  clear(result);
  progFill.style.width = '0%';
  progText.textContent = 'Starting...';
  try {
    const { entries, skipped } = await exportClips({
      clips: state.clips,
      sources: state.sources,
      formats: f,
      normalize: state.settings.normalize,
      trim: state.settings.trim,
      phraseNames: state.settings.phraseNames,
      onProgress: ({ done, total, name }) => {
        progFill.style.width = `${total ? (done / total) * 100 : 0}%`;
        progText.textContent = `Rendering clip ${Math.min(done + 1, total)} of ${total}${name ? `: ${name}` : ''}`;
        setStatus(`Rendering clip ${Math.min(done + 1, total)} of ${total}...`);
      },
    });
    progText.textContent = 'Zipping...';
    const clipFiles = entries.filter((e) => e.name !== 'manifest.csv').length;
    if (!clipFiles) throw new Error('nothing rendered');
    const blob = await makeZip(entries);
    const name = zipName();
    saveBlob(blob, name);
    const rendered = state.clips.length - skipped.length;
    const mb = blob.size / 1048576;
    result.className = 'export-result ok';
    result.append(el('p', { text: `Done. ${pluralise(rendered, 'clip')} as ${f.map((x) => x.toUpperCase()).join(' + ')} (${pluralise(clipFiles, 'file')}, ${mb < 0.1 ? '<0.1' : mb.toFixed(1)} MB) saved as ${name}. manifest.csv is inside.` }));
    if (skipped.length) {
      const names = [...new Set(skipped.map((c) => getSource(c.sourceId)?.name || 'unknown'))];
      result.append(el('p', { class: 'warn', text: `${pluralise(skipped.length, 'clip')} skipped because the audio is not loaded (${names.join(', ')}). Drop the original file${names.length > 1 ? 's' : ''} to relink, then export again.` }));
    }
    showKofiNudge();
    setStatus(`Exported ${pluralise(rendered, 'clip')}.`);
  } catch (err) {
    console.error(err);
    result.className = 'export-result bad';
    result.append(el('p', { text: 'The export did not finish. Nothing was saved.' }));
    showError(err);
  } finally {
    progWrap.hidden = true;
    setBusy('export', false);
    refresh();
  }
}

// ---- project ---------------------------------------------------------------
function projectName() {
  const s = activeSource() || state.sources[0];
  return s ? baseName(s.name) : 'vox-slice';
}

export function saveProject() {
  const sources = state.sources.filter((s) => s.words.length);
  const ids = new Set(sources.map((s) => s.id));
  const clips = state.clips.filter((c) => ids.has(c.sourceId));
  const data = serializeProject({ sources, clips, settings: { ...state.settings } });
  const name = `${projectName()}.voxslice.json`;
  saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name);
  setStatus(`Saved ${name}. It holds transcripts and clips, not audio. Drop the original files to relink after loading.`);
}

export async function loadProjectFile(file) {
  try {
    const p = parseProject(await file.text());
    const idMap = new Map();
    let addedSources = 0;
    for (const s of p.sources) {
      const same = s.hash && state.sources.find((x) => x.hash === s.hash);
      if (same) { idMap.set(s.id, same.id); continue; }
      const orig = s.id;
      if (state.sources.some((x) => x.id === s.id)) s.id = uid('s');
      idMap.set(orig, s.id);
      state.sources.push(s);
      meta.set(s.id, { status: 'ready' });
      addedSources++;
    }
    // map original ids (parse output kept them) to final ids
    const have = new Set(state.clips.map((c) => c.id));
    let addedClips = 0;
    const added = [];
    for (const c of p.clips) {
      const sid = idMap.get(c.sourceId) || c.sourceId;
      if (!getSource(sid)) continue;
      const clip = { ...c, sourceId: sid };
      if (have.has(clip.id)) clip.id = uid('c');
      state.clips.push(clip); added.push(clip); addedClips++;
    }
    const st = p.settings || {};
    for (const k of ['padMs', 'gapMs']) if (Number.isFinite(st[k])) state.settings[k] = st[k];
    if (typeof st.packName === 'string') state.settings.packName = st.packName.slice(0, 80);
    for (const k of ['normalize', 'trim', 'wav', 'mp3', 'phraseNames']) if (typeof st[k] === 'boolean') state.settings[k] = st[k];
    applySettingsToControls();
    emit('sources');
    emit('clips', { added });
    if (!getSource(state.activeId)) setActive((p.sources[0] && idMap.get(p.sources[0].id)) || state.sources[0]?.id || null);
    const missing = state.sources.filter((s) => !s.buffer && s.words.length).length;
    setStatus(`Project loaded: ${pluralise(addedSources, 'speech', 'speeches')}, ${pluralise(addedClips, 'clip')}.${missing ? ' Drop the original audio files to relink them (playback and export need audio).' : ''}`);
  } catch (err) {
    showError(err);
  }
}

function applySettingsToControls() {
  const s = state.settings;
  tid('fmt-wav').checked = s.wav;
  tid('fmt-mp3').checked = s.mp3;
  tid('opt-normalize').checked = s.normalize;
  tid('opt-trim').checked = s.trim;
  tid('opt-phrase-names').checked = s.phraseNames;
  tid('pack-name-input').value = s.packName;
  const pad = tid('pad-input');
  pad.value = String(s.padMs);
  pad.dispatchEvent(new Event('input'));
  const gap = document.getElementById('gap-input');
  if (gap) { gap.value = String(s.gapMs); gap.dispatchEvent(new Event('input')); }
  refresh();
}

export function initExport() {
  zipBtn = tid('export-zip-btn');
  result = document.getElementById('export-result');
  progWrap = document.getElementById('export-progress');
  progFill = progWrap.querySelector('.bar > div');
  progText = progWrap.querySelector('.prog-detail');
  const bind = (id, key) => tid(id).addEventListener('change', (e) => { state.settings[key] = e.target.checked; refresh(); });
  bind('fmt-wav', 'wav'); bind('fmt-mp3', 'mp3'); bind('opt-normalize', 'normalize'); bind('opt-trim', 'trim'); bind('opt-phrase-names', 'phraseNames');
  const pack = tid('pack-name-input');
  const packHint = document.getElementById('pack-name-hint');
  const paintPack = () => { packHint.textContent = `Saves as ${zipName()}`; };
  pack.addEventListener('input', () => { state.settings.packName = pack.value; paintPack(); });
  for (const ev of ['clips', 'sources']) on(ev, paintPack);
  applySettingsToControls();
  paintPack();
  zipBtn.addEventListener('click', exportZip);
  tid('save-project-btn').addEventListener('click', saveProject);
  const inp = tid('load-project-input');
  inp.addEventListener('change', async () => { for (const f of inp.files) await loadProjectFile(f); inp.value = ''; });
  for (const ev of ['clips', 'sources', 'busy', 'relinked']) on(ev, refresh);
  refresh();
}
