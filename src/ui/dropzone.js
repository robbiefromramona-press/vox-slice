// Drop zone + file input. Accepts several files, plus project (.json) files.
import { tid } from './dom.js';
import { state, on, setStatus } from './state.js';
import { enqueueFiles, MODEL_MB } from './loader.js';
import { loadProjectFile } from './exportPanel.js';

function route(fileList) {
  const files = [...fileList];
  const projects = files.filter((f) => /\.json$/i.test(f.name));
  const audio = files.filter((f) => !/\.json$/i.test(f.name));
  for (const p of projects) loadProjectFile(p);
  if (audio.length) enqueueFiles(audio);
}

export function initDropzone() {
  const zone = tid('drop-zone');
  const input = tid('file-input');
  const select = tid('model-select');

  select.value = state.settings.model;
  select.addEventListener('change', () => {
    state.settings.model = select.value;
    const mb = MODEL_MB[select.value];
    setStatus(`Model set. It downloads about ${mb} MB the first time, then it is cached.`);
  });

  input.addEventListener('change', () => { route(input.files); input.value = ''; });
  zone.addEventListener('click', (e) => { if (e.target.closest('select, label.model-pick')) return; input.click(); });
  zone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target === zone || e.target.closest('.drop'))) { e.preventDefault(); input.click(); }
  });

  let depth = 0;
  const over = (v) => { zone.classList.toggle('over', v); document.body.classList.toggle('dragging-file', v); };
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; over(true); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) over(false); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0; over(false);
    if (e.voxHandled) return; // the Import phrases panel took this drop (a .txt list)
    if (e.dataTransfer && e.dataTransfer.files.length) route(e.dataTransfer.files);
  });

  const bars = zone.querySelector('.bars');
  for (let i = 0; i < 40; i++) {
    const b = document.createElement('i');
    const h = 0.18 + 0.82 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21 + 1)) ;
    b.style.setProperty('--h', h.toFixed(2));
    b.style.setProperty('--d', `${(i * 37) % 900}ms`);
    bars.prepend(b);
  }
  const body = document.body;
  const sync = () => body.classList.toggle('has-sources', state.sources.length > 0);
  on('sources', sync);
  sync();
  document.getElementById('add-more-btn').addEventListener('click', () => input.click());
  on('status', (e) => { document.getElementById('status-text').textContent = e.detail; });
}
