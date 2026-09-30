const $ = s => document.querySelector(s);
const LOWMEM = (navigator.deviceMemory && navigator.deviceMemory <= 4) || /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const FINAL_BUDGET = LOWMEM ? 20e6 : 70e6;
const PREVIEW_BUDGET = LOWMEM ? 3e6 : 8e6;
const MAX_SRC = LOWMEM ? 16e6 : 40e6;
const FACTORS = [1, 2, 3, 4, 6, 8];
const PRESETS = {
  ink:   { thr: 50, autoThr: false, factor: 'auto', specks: 0.5, alpha: 1.0, resampler: 0, tol: 0.2, flat: false, denoise: false },
  scan:  { thr: 50, autoThr: true,  factor: 'auto', specks: 4,   alpha: 1.0, resampler: 0, tol: 0.2, flat: true,  denoise: true },
  logo:  { thr: 50, autoThr: true,  factor: 'auto', specks: 2,   alpha: 1.0, resampler: 0, tol: 0.2, flat: false, denoise: false },
  pixel: { thr: 50, autoThr: false, factor: '1',    specks: 0,   alpha: 0,   resampler: 2, tol: 0,   flat: false, denoise: false },
};
const PAGES = { letter: [215.9, 279.4], a4: [210, 297], a5: [148, 210], '8x10': [203.2, 254], '85x85': [215.9, 215.9] };

let files = [];
let active = null;
let worker = null;
let workerReady = null;
let loadedId = null;
let jobSeq = 0;
let current = null;
let busySince = 0;
let debounce = null;
let view = { z: 1, x: 0, y: 0, mode: 'side', swipe: 0.5 };
let diffUrl = null;

function spawn() {
  worker = new Worker('/assets/__WORKER__', { type: 'module' });
  loadedId = null;
  worker.onmessage = onWorker;
  worker.onerror = e => setStatus('Engine error: ' + (e.message || 'unknown'), 'err');
}
spawn();

function setStatus(t, cls = '') { const s = $('#status'); s.textContent = t; s.className = cls; }
function progress(p) { const el = $('#prog'); el.classList.toggle('on', p != null); el.firstElementChild.style.width = ((p || 0) * 100).toFixed(1) + '%'; }

function opts() {
  return {
    thr: +$('#thr').value / 100, autoThr: $('#autoThr').checked, specks: +$('#specks').value, alphamax: +$('#alpha').value,
    invert: $('#invert').checked, resampler: +$('#resampler').value, tolerance: +$('#tol').value,
    flat: $('#flat').checked, denoise: $('#denoise').checked, alphaInk: $('#alphaInk').checked,
  };
}
function autoFactor(w, h, budget) { let f = 1; for (const k of FACTORS) if (w * h * k * k <= budget) f = k; return f; }
function finalFactor(f) { const v = $('#factor').value; return v === 'auto' ? autoFactor(f.w, f.h, FINAL_BUDGET) : +v; }
function previewFactor(f) { return Math.min(finalFactor(f), autoFactor(f.w, f.h, PREVIEW_BUDGET)); }
function optKey(o) { return JSON.stringify(o); }

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  $('#thr').value = p.thr; $('#autoThr').checked = p.autoThr; $('#factor').value = p.factor; $('#specks').value = p.specks;
  $('#alpha').value = p.alpha; $('#resampler').value = p.resampler; $('#tol').value = p.tol; $('#flat').checked = p.flat; $('#denoise').checked = p.denoise;
  labels();
}
function labels() {
  $('#thrV').textContent = $('#thr').value + '%';
  $('#specksV').textContent = $('#specks').value + ' px²';
  $('#alphaV').textContent = (+$('#alpha').value).toFixed(2);
  $('#tolV').textContent = (+$('#tol').value).toFixed(2);
  $('#marginV').textContent = $('#margin').value + ' mm';
  $('#thr').disabled = $('#autoThr').checked;
  $('#svgWRow').classList.toggle('dim', $('#svgSize').value === 'px');
  if (active && active.w) {
    const ff = finalFactor(active), pf = previewFactor(active);
    const auto = $('#factor').value === 'auto';
    const big = active.w * active.h * ff * ff;
    let t = `${auto ? 'Auto → ' + ff + '× · ' : ''}${(big / 1e6).toFixed(0)} MP trace`;
    if (pf < ff) t += ` · preview at ${pf}×`;
    $('#factorHint').textContent = t;
    $('#factorHint').className = 'hint' + (!auto && big > FINAL_BUDGET ? ' warn' : '');
    if (!auto && big > FINAL_BUDGET) $('#factorHint').textContent += ' — may run out of memory on this device';
  }
}

function addFiles(list) {
  const imgs = [...list].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
  if (!imgs.length) { setStatus('No image files found.', 'err'); return; }
  for (const f of imgs) files.push({ id: Math.random().toString(36).slice(2), file: f, name: f.name, url: URL.createObjectURL(f), results: {} });
  $('#drop').classList.add('compact');
  $('#tool').classList.add('show');
  renderFiles();
  if (!active) select(files[files.length - imgs.length]);
}
function renderFiles() {
  const box = $('#files');
  if (files.length < 2) { box.innerHTML = ''; $('#dlZip').hidden = $('#dlBook').hidden = $('#dlDxfZip').hidden = true; return; }
  box.innerHTML = files.map(f => `<div class="fcard${f === active ? ' on' : ''}" data-id="${f.id}"><span class="x" data-x="1" title="Remove">×</span><img src="${f.url}" alt=""><div class="nm">${f.results.final ? '<span class="ok">✓</span> ' : ''}${f.name.replace(/</g, '&lt;')}</div></div>`).join('');
  $('#dlZip').hidden = $('#dlBook').hidden = $('#dlDxfZip').hidden = false;
}
$('#files').addEventListener('click', e => {
  const card = e.target.closest('.fcard'); if (!card) return;
  const f = files.find(x => x.id === card.dataset.id);
  if (e.target.dataset.x) {
    URL.revokeObjectURL(f.url);
    files = files.filter(x => x !== f);
    if (active === f) { active = null; if (files.length) select(files[0]); else { $('#tool').classList.remove('show'); $('#drop').classList.remove('compact'); } }
    renderFiles();
    return;
  }
  select(f);
});

function load(f) {
  return new Promise((resolve, reject) => {
    f._resolve = resolve; f._reject = reject;
    worker.postMessage({ type: 'load', id: f.id, file: f.file, maxPixels: MAX_SRC });
  });
}
async function ensureLoaded(f) {
  if (loadedId === f.id) return;
  setStatus('Loading ' + f.name + '…');
  const info = await load(f);
  loadedId = f.id;
  Object.assign(f, info);
}
async function select(f) {
  active = f;
  renderFiles();
  try { await ensureLoaded(f); } catch (e) { setStatus('Could not read ' + f.name + ': ' + e, 'err'); return; }
  $('#otsuV').textContent = `(${Math.round(f.otsu * 100)}%)`;
  $('#scanHint').hidden = !(f.paper < 235 || f.midFrac > 0.25) || $('#preset').value === 'scan';
  if (f.hasAlpha) $('#alphaInk').closest('.row').title = 'This image has transparency';
  setStatus(f.note || '', f.note ? 'warn' : '');
  buildPanes(true);
  labels();
  schedule(0);
}

function onWorker(e) {
  const m = e.data;
  if (m.type === 'loaded') { const f = files.find(x => x.id === m.id); if (f && f._resolve) f._resolve(m); return; }
  if (m.type === 'loadError') { const f = files.find(x => x.id === m.id); if (f && f._reject) f._reject(m.msg); return; }
  if (m.type === 'progress') { if (current) progress(current.final ? m.p : m.p); return; }
  if (!current || m.job !== current.job) return;
  const job = current;
  current = null; busySince = 0; progress(null);
  if (m.type === 'error') {
    if (m.oom && job.factor > 1) {
      const lower = FACTORS.filter(k => k < job.factor).pop();
      setStatus(`Not enough memory at ${job.factor}× — retried at ${lower}×.`, 'warn');
      if (m.fatal) { worker.terminate(); spawn(); }
      run({ ...job, factor: lower, forced: true });
      return;
    }
    setStatus(m.msg, 'err');
    if (m.fatal) { worker.terminate(); spawn(); }
    return;
  }
  const f = files.find(x => x.id === m.id);
  if (!f) return;
  const res = { d: m.d, w: m.w, h: m.h, factor: m.factor, thr: m.thr, paths: m.paths, segments: m.segments, ms: m.ms, key: job.key };
  if (job.final) f.results.final = res; else f.results.preview = res;
  if (job.batch) { job.batch(res); return; }
  if (f === active) {
    showResult(res, job.final);
    if (!job.final && finalFactor(f) > res.factor) schedule(350, true);
  }
  renderFiles();
}

function run(job) {
  if (current && busySince && performance.now() - busySince > 2000) {
    worker.terminate(); spawn(); current = null;
  }
  const f = job.file;
  const go = async () => {
    try { await ensureLoaded(f); } catch (e) { setStatus(String(e), 'err'); return; }
    current = job; busySince = performance.now();
    progress(0);
    worker.postMessage({ type: 'trace', job: job.job, id: f.id, factor: job.factor, opts: job.opts });
  };
  go();
}
function markPending() {
  ['#dlSvg', '#dlPdf', '#dlDxf', '#copySvg'].forEach(s => $(s).disabled = true);
  const st = $('#stats');
  if (st.textContent && !st.querySelector('.upd')) st.insertAdjacentHTML('beforeend', ' <span class="q upd">· updating…</span>');
}
function schedule(delay, final = false) {
  clearTimeout(debounce);
  if (!final) markPending();
  debounce = setTimeout(() => {
    if (!active || !active.w) return;
    const o = opts(), key = optKey(o);
    const factor = final ? finalFactor(active) : previewFactor(active);
    const have = active.results.final;
    if (have && have.key === key && have.factor === finalFactor(active)) { showResult(have, true); return; }
    run({ job: ++jobSeq, file: active, factor, opts: o, key, final: final || factor === finalFactor(active) });
  }, delay);
}

function svgString(res, forDisplay = false) {
  const color = $('#color').value, bg = $('#bg').value;
  let size = `width="${res.w}" height="${res.h}"`;
  const unit = $('#svgSize').value;
  if (!forDisplay && unit !== 'px') {
    const sw = +$('#svgW').value || 100;
    size = `width="${sw}${unit}" height="${+(sw * res.h / res.w).toFixed(3)}${unit}"`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${res.w} ${res.h}" ${size}>` +
    (bg !== 'none' ? `<rect width="${res.w}" height="${res.h}" fill="${bg}"/>` : '') +
    `<path fill="${color}" d="${res.d}"/></svg>`;
}

let traceUrl = null;
let shown = null;
function showResult(res, final) {
  shown = res;
  if (traceUrl) URL.revokeObjectURL(traceUrl);
  traceUrl = URL.createObjectURL(new Blob([svgString(res, true)], { type: 'image/svg+xml' }));
  document.querySelectorAll('img.trace').forEach(i => i.src = traceUrl);
  const bytes = new Blob([svgString(res)]).size;
  $('#stats').innerHTML = `${res.factor}× · ${res.paths.toLocaleString()} shapes · ${res.segments.toLocaleString()} curve segments · ${(bytes / 1024).toFixed(0)} KB · ${res.ms.toFixed(0)} ms` +
    (final ? '' : ' <span class="q">· preview, refining…</span>') + ' <span id="match" class="q"></span>';
  ['#dlSvg', '#dlPdf', '#dlDxf', '#copySvg'].forEach(s => $(s).disabled = !final);
  if (final) measure(res);
  if (view.mode === 'diff') buildDiff(res);
}

function rasterPair(res, maxPx = 4e6) {
  return new Promise(resolve => {
    const s = Math.min(1, Math.sqrt(maxPx / (res.w * res.h)));
    const w = Math.max(1, Math.round(res.w * s)), h = Math.max(1, Math.round(res.h * s));
    const a = new Image(), b = new Image();
    let n = 0;
    const done = () => {
      if (++n < 2) return;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(a, 0, 0, w, h);
      const A = x.getImageData(0, 0, w, h).data;
      x.fillRect(0, 0, w, h); x.drawImage(b, 0, 0, w, h);
      const B = x.getImageData(0, 0, w, h).data;
      resolve({ w, h, A, B, c, x });
    };
    a.onload = b.onload = done;
    a.src = active.url;
    const inv = $('#invert').checked;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${res.w} ${res.h}" width="${res.w}" height="${res.h}"><rect width="${res.w}" height="${res.h}" fill="${inv ? '#000' : '#fff'}"/><path fill="${inv ? '#fff' : '#000'}" d="${res.d}"/></svg>`;
    b.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  });
}
const lum = (d, i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
async function measure(res) {
  if ($('#flat').checked || $('#denoise').checked || $('#alphaInk').checked) { const m = $('#match'); if (m) m.textContent = ''; return; }
  const { w, h, A, B } = await rasterPair(res);
  let s = 0;
  for (let i = 0; i < A.length; i += 4) s += Math.abs(lum(A, i) - lum(B, i));
  const m = $('#match');
  if (m && shown === res) m.textContent = `· differs from original ${(s / (w * h) * 100).toFixed(1)}% (mostly edge shading)`;
}
async function buildDiff(res) {
  const { w, h, A, B, c, x } = await rasterPair(res);
  const out = x.createImageData(w, h), o = out.data;
  const inv = $('#invert').checked;
  for (let i = 0; i < A.length; i += 4) {
    let a = lum(A, i) < 0.5, b = lum(B, i) < 0.5;
    if (inv) a = !a, b = !b;
    const v = lum(A, i);
    let r = 255 - (255 - v * 255) * 0.25, g = r, bl = r;
    if (a && b) r = g = bl = 60;
    else if (a) { r = 224; g = 67; bl = 90; }
    else if (b) { r = 91; g = 141; bl = 239; }
    o[i] = r; o[i + 1] = g; o[i + 2] = bl; o[i + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  c.toBlob(bl => { if (diffUrl) URL.revokeObjectURL(diffUrl); diffUrl = URL.createObjectURL(bl); document.querySelectorAll('img.diff').forEach(i => i.src = diffUrl); });
}

function buildPanes(reset) {
  const panes = $('#panes');
  const m = view.mode;
  panes.className = 'panes' + (m === 'side' ? '' : ' single');
  const checker = $('#bg').value === 'none' ? ' checker' : '';
  if (m === 'side') panes.innerHTML = `<div class="pane"><span class="tag">Original</span><div class="stage"><img class="orig" alt=""></div></div><div class="pane${checker}"><span class="tag">Vector</span><div class="stage"><img class="trace" alt=""></div></div>`;
  else if (m === 'swipe') panes.innerHTML = `<div class="pane${checker}"><span class="tag">Original ⇆ Vector</span><div class="stage"><img class="orig" alt=""><img class="trace" alt="" id="swipeImg"></div><div class="swipe-line" id="swipeLine"></div></div>`;
  else panes.innerHTML = `<div class="pane"><span class="tag">Differences</span><div class="stage"><img class="diff" alt=""></div></div>`;
  $('#legend').hidden = m !== 'diff';
  document.querySelectorAll('img.orig').forEach(i => i.src = active ? active.url : '');
  if (traceUrl) document.querySelectorAll('img.trace').forEach(i => i.src = traceUrl);
  if (diffUrl) document.querySelectorAll('img.diff').forEach(i => i.src = diffUrl);
  document.querySelectorAll('.pane').forEach(bindPane);
  if (reset) fit(); else layout();
  if (m === 'diff' && shown) buildDiff(shown);
}
function paneBox() { const p = document.querySelector('.pane'); return p ? [p.clientWidth, p.clientHeight] : [1, 1]; }
function baseScale() { if (!active || !active.w) return 1; const [pw, ph] = paneBox(); return Math.min(pw / active.w, ph / active.h); }
function fit() {
  if (!active || !active.w) return;
  const [pw, ph] = paneBox(), s = baseScale();
  view.z = 1; view.x = (pw - active.w * s) / 2; view.y = (ph - active.h * s) / 2;
  layout();
}
function layout() {
  if (!active || !active.w) return;
  const s = baseScale();
  document.querySelectorAll('.stage').forEach(st => {
    st.style.width = active.w * s + 'px'; st.style.height = active.h * s + 'px';
    st.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  });
  $('#zoom').value = view.z; $('#zoomV').textContent = (+view.z).toFixed(2).replace(/\.?0+$/, '') + '×';
  const img = $('#swipeImg'), line = $('#swipeLine');
  if (img && line) {
    const [pw] = paneBox();
    const sx = view.swipe * pw;
    const stageX = (sx - view.x) / view.z;
    img.style.clipPath = `inset(0 0 0 ${Math.max(0, stageX)}px)`;
    line.style.left = sx - 1 + 'px';
  }
}
function zoomAt(nz, cx, cy) {
  nz = Math.min(16, Math.max(1, nz));
  view.x = cx - (cx - view.x) * nz / view.z; view.y = cy - (cy - view.y) * nz / view.z; view.z = nz;
  layout();
}
function bindPane(p) {
  let start = null, orig = null, swiping = false;
  p.addEventListener('wheel', e => { e.preventDefault(); const r = p.getBoundingClientRect(); zoomAt(view.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  p.addEventListener('pointerdown', e => {
    p.setPointerCapture(e.pointerId);
    swiping = e.target.id === 'swipeLine';
    start = [e.clientX, e.clientY]; orig = [view.x, view.y];
  });
  p.addEventListener('pointermove', e => {
    if (!start) return;
    if (swiping) { const r = p.getBoundingClientRect(); view.swipe = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); layout(); return; }
    view.x = orig[0] + e.clientX - start[0]; view.y = orig[1] + e.clientY - start[1]; layout();
  });
  p.addEventListener('pointerup', () => { start = null; swiping = false; });
  p.addEventListener('dblclick', e => { const r = p.getBoundingClientRect(); zoomAt(view.z < 4 ? view.z * 2.5 : 1, e.clientX - r.left, e.clientY - r.top); });
}
$('#zoom').addEventListener('input', e => { const [pw, ph] = paneBox(); zoomAt(+e.target.value, pw / 2, ph / 2); });
$('#fit').addEventListener('click', fit);
$('#mode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  view.mode = b.dataset.m;
  document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
  buildPanes(false);
});
addEventListener('resize', () => layout());

const traceInputs = ['#thr', '#autoThr', '#factor', '#specks', '#alpha', '#invert', '#resampler', '#tol', '#flat', '#denoise', '#alphaInk'];
traceInputs.forEach(s => $(s).addEventListener('input', () => { $('#preset').value = 'custom'; $('#preset').querySelector('[value=custom]').hidden = false; labels(); schedule(180); }));
$('#preset').addEventListener('change', e => { applyPreset(e.target.value); $('#scanHint').hidden = true; schedule(0); });
['#color', '#bg'].forEach(s => $(s).addEventListener('input', () => { if (s === '#bg') buildPanes(false); if (shown) showResult(shown, !!(active && active.results.final === shown)); }));
['#svgSize', '#svgW', '#margin', '#page'].forEach(s => $(s).addEventListener('input', labels));

const drop = $('#drop');
$('#file').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) addFiles(f); });

function baseName(f) { return f.name.replace(/\.[^.]+$/, '') || 'trace'; }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function finalFor(f) {
  const o = opts(), key = optKey(o), factor = finalFactor(f);
  if (f.results.final && f.results.final.key === key && f.results.final.factor === factor) return Promise.resolve(f.results.final);
  return new Promise(resolve => run({ job: ++jobSeq, file: f, factor, opts: o, key, final: true, batch: resolve }));
}
$('#dlSvg').addEventListener('click', () => download(new Blob([svgString(active.results.final)], { type: 'image/svg+xml' }), baseName(active) + '.svg'));
$('#copySvg').addEventListener('click', async () => { await navigator.clipboard.writeText(svgString(active.results.final)); setStatus('SVG copied to the clipboard.'); });

let pdfLib = null;
function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); }); }
async function ensurePdf() { if (!pdfLib) { await loadScript('/assets/pdf-lib.min.js'); pdfLib = window.PDFLib; } return pdfLib; }
const MM = 72 / 25.4;
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
async function addPdfPage(doc, res) {
  const { rgb } = pdfLib;
  const margin = +$('#margin').value * MM;
  let pw, ph;
  const pg = $('#page').value;
  if (pg === 'fit') { pw = res.w * 0.75 + 2 * margin; ph = res.h * 0.75 + 2 * margin; }
  else { [pw, ph] = PAGES[pg].map(v => v * MM); if ((res.w > res.h) !== (pw > ph) && pg !== '85x85') [pw, ph] = [ph, pw]; }
  const page = doc.addPage([pw, ph]);
  const bg = $('#bg').value;
  if (bg !== 'none') page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(...hexRgb(bg)) });
  const s = Math.min((pw - 2 * margin) / res.w, (ph - 2 * margin) / res.h);
  const ox = (pw - res.w * s) / 2, oy = ph - (ph - res.h * s) / 2;
  page.drawSvgPath(res.d, { x: ox, y: oy, scale: s, color: rgb(...hexRgb($('#color').value)), borderWidth: 0 });
}
$('#dlPdf').addEventListener('click', async () => {
  setStatus('Building PDF…');
  const { PDFDocument } = await ensurePdf();
  const doc = await PDFDocument.create();
  await addPdfPage(doc, active.results.final);
  download(new Blob([await doc.save()], { type: 'application/pdf' }), baseName(active) + '.pdf');
  setStatus('PDF ready.');
});
async function each(fn) {
  const keep = active;
  for (let i = 0; i < files.length; i++) {
    setStatus(`Tracing ${i + 1} of ${files.length}: ${files[i].name}…`);
    const res = await finalFor(files[i]);
    await fn(files[i], res);
    renderFiles();
  }
  if (keep) { await ensureLoaded(keep); }
}
$('#dlZip').addEventListener('click', async () => {
  const out = {};
  await each((f, res) => { out[baseName(f) + '.svg'] = new TextEncoder().encode(svgString(res)); });
  download(new Blob([fflate.zipSync(out, { level: 6 })], { type: 'application/zip' }), 'traced-svgs.zip');
  setStatus(`Zipped ${files.length} SVGs.`);
});
$('#dlBook').addEventListener('click', async () => {
  const { PDFDocument } = await ensurePdf();
  const doc = await PDFDocument.create();
  await each(async (f, res) => { await addPdfPage(doc, res); });
  download(new Blob([await doc.save()], { type: 'application/pdf' }), 'book.pdf');
  setStatus(`One PDF with ${files.length} pages ready.`);
});

const DXF_TOL = 0.1;
function cubicFlat(p0, p1, p2, p3, out, depth) {
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1], L = Math.hypot(dx, dy);
  const d1 = L ? Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / L : Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const d2 = L ? Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / L : Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  if (depth > 14 || Math.max(d1, d2) <= DXF_TOL) { out.push([p3[0], p3[1]]); return; }
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const a = m(p0, p1), b = m(p1, p2), c = m(p2, p3), ab = m(a, b), bc = m(b, c), mid = m(ab, bc);
  cubicFlat(p0, a, ab, mid, out, depth + 1);
  cubicFlat(mid, bc, c, p3, out, depth + 1);
}
function pathPolys(d, ox = 0, oy = 0) {
  const tok = d.match(/[MLHVCQZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const polys = [];
  let cur = null, i = 0, cmd = '', rel = false, x = 0, y = 0, sx = 0, sy = 0;
  const num = () => +tok[i++];
  const close = () => { if (cur && cur.length > 2) polys.push(cur); cur = null; };
  while (i < tok.length) {
    const t = tok[i];
    if (/^[a-z]$/i.test(t)) {
      i++;
      rel = t === t.toLowerCase();
      cmd = t.toUpperCase();
      if (cmd === 'Z') { close(); x = sx; y = sy; continue; }
    }
    const bx = rel ? x : 0, by = rel ? y : 0;
    if (cmd === 'M') { close(); x = bx + num(); y = by + num(); sx = x; sy = y; cur = [[x, y]]; cmd = 'L'; }
    else if (cmd === 'L') { x = bx + num(); y = by + num(); cur.push([x, y]); }
    else if (cmd === 'H') { x = bx + num(); cur.push([x, y]); }
    else if (cmd === 'V') { y = by + num(); cur.push([x, y]); }
    else if (cmd === 'C') { const p1 = [bx + num(), by + num()], p2 = [bx + num(), by + num()], p3 = [bx + num(), by + num()]; cubicFlat([x, y], p1, p2, p3, cur, 0); x = p3[0]; y = p3[1]; }
    else if (cmd === 'Q') { const q = [bx + num(), by + num()], p3 = [bx + num(), by + num()]; cubicFlat([x, y], [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)], [p3[0] + 2 / 3 * (q[0] - p3[0]), p3[1] + 2 / 3 * (q[1] - p3[1])], p3, cur, 0); x = p3[0]; y = p3[1]; }
    else i++;
  }
  close();
  if (ox || oy) polys.forEach(p => p.forEach(v => { v[0] += ox; v[1] += oy; }));
  return polys;
}
const ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0], [8, 128, 128, 128], [9, 192, 192, 192]];
function aci(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  let best = 7, bd = Infinity;
  for (const [k, R, G, B] of ACI) { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}
function dxfString(layers, w, h) {
  const unit = $('#svgSize').value;
  const scale = unit === 'px' ? 1 : (+$('#svgW').value || 100) / w;
  const ins = unit === 'mm' ? 4 : unit === 'in' ? 1 : 0;
  const f = v => { const s = (+v.toFixed(4)).toString(); return s === '-0' ? '0' : s; };
  const o = [];
  const g = (c, v) => o.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, ins);
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0); g(9, '$EXTMAX'); g(10, f(w * scale)); g(20, f(h * scale)); g(30, 0);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const L of layers) { g(0, 'LAYER'); g(2, L.name); g(70, 0); g(62, L.aci); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const L of layers) {
    for (const poly of L.polys) {
      g(0, 'POLYLINE'); g(8, L.name); g(66, 1); g(70, 1); g(10, 0); g(20, 0); g(30, 0);
      let px = null, py = null;
      for (const [x, y] of poly) {
        const X = f(x * scale), Y = f((h - y) * scale);
        if (X === px && Y === py) continue;
        px = X; py = Y;
        g(0, 'VERTEX'); g(8, L.name); g(10, X); g(20, Y); g(30, 0);
      }
      g(0, 'SEQEND'); g(8, L.name);
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
function dxfFor(res) {
  const color = $('#color').value;
  return dxfString([{ name: 'TRACE', aci: aci(color), polys: pathPolys(res.d) }], res.w, res.h);
}
$('#dlDxf').addEventListener('click', () => download(new Blob([dxfFor(active.results.final)], { type: 'application/dxf' }), baseName(active) + '.dxf'));
$('#dlDxfZip').addEventListener('click', async () => {
  const out = {};
  await each((f, res) => { out[baseName(f) + '.dxf'] = new TextEncoder().encode(dxfFor(res)); });
  download(new Blob([fflate.zipSync(out, { level: 6 })], { type: 'application/zip' }), 'traced-dxf.zip');
  setStatus(`Zipped ${files.length} DXF files.`);
});

if (document.body.dataset.units) { $('#svgSize').value = document.body.dataset.units; $('#svgW').value = 100; labels(); }
const initial = document.body.dataset.preset;
if (PRESETS[initial]) { $('#preset').value = initial; applyPreset(initial); } else applyPreset('ink');
