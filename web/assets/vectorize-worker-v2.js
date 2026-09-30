import createPotrace from '/assets/potrace-r2/potrace-v1.js';

const ready = createPotrace();
let src = null;
const cache = new Map();
let pending = null;
let scheduled = false;

function luma(rgba, n, alphaInk) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3];
    if (alphaInk) {
      g[i] = 255 - a;
      continue;
    }
    let r = rgba[j], gg = rgba[j + 1], b = rgba[j + 2];
    if (a < 255) {
      r = Math.round((r * a + 255 * (255 - a)) / 255);
      gg = Math.round((gg * a + 255 * (255 - a)) / 255);
      b = Math.round((b * a + 255 * (255 - a)) / 255);
    }
    g[i] = (r * 19595 + gg * 38470 + b * 7471 + 0x8000) >> 16;
  }
  return g;
}

function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t + 0.5; }
  }
  let mid = 0, paper = 0;
  for (let t = 60; t <= 200; t++) mid += hist[t];
  let acc = 0;
  for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc >= total * 0.5) { paper = t; break; } }
  return { thr: thr / 255, midFrac: mid / total, paper };
}

function maxFilter1D(src, dst, len, r, getIdx) {
  const k = 2 * r + 1, m = len + 2 * r;
  const buf = new Uint8Array(m), L = new Uint8Array(m), R = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const s = Math.min(len - 1, Math.max(0, i - r));
    buf[i] = src[getIdx(s)];
  }
  for (let i = 0; i < m; i++) L[i] = (i % k === 0) ? buf[i] : Math.max(L[i - 1], buf[i]);
  for (let i = m - 1; i >= 0; i--) R[i] = (i % k === k - 1 || i === m - 1) ? buf[i] : Math.max(R[i + 1], buf[i]);
  for (let i = 0; i < len; i++) dst[getIdx(i)] = Math.max(R[i], L[i + k - 1]);
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const o = y * w;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / (2 * r + 1);
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function flatField(g, w, h) {
  const r = Math.max(3, Math.round(Math.max(w, h) / 120));
  const a = new Uint8Array(g.length), b = new Uint8Array(g.length);
  for (let y = 0; y < h; y++) maxFilter1D(g, a, w, r, i => y * w + i);
  for (let x = 0; x < w; x++) maxFilter1D(a, b, h, r, i => i * w + x);
  const bg = boxBlur(b, w, h, 2 * r);
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.min(255, Math.round(g[i] * 255 / Math.max(bg[i], 1)));
  return out;
}

function median3(g, w, h) {
  const out = new Uint8Array(g.length);
  const v = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
        for (let dx = -1; dx <= 1; dx++) v[n++] = g[yy + Math.min(w - 1, Math.max(0, x + dx))];
      }
      v.sort();
      out[y * w + x] = v[4];
    }
  }
  return out;
}

function prepared(o) {
  const key = `${o.alphaInk ? 1 : 0}${o.flat ? 1 : 0}${o.denoise ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  let g = luma(src.rgba, src.w * src.h, o.alphaInk);
  if (o.denoise) g = median3(g, src.w, src.h);
  if (o.flat) g = flatField(g, src.w, src.h);
  const entry = { g, stats: otsu(g) };
  cache.set(key, entry);
  return entry;
}

async function load(msg) {
  const bmp0 = await createImageBitmap(msg.file, { imageOrientation: 'from-image' });
  let w = bmp0.width, h = bmp0.height, note = '';
  let bmp = bmp0;
  if (w * h > msg.maxPixels) {
    const s = Math.sqrt(msg.maxPixels / (w * h));
    const nw = Math.max(1, Math.floor(w * s)), nh = Math.max(1, Math.floor(h * s));
    bmp = await createImageBitmap(msg.file, { imageOrientation: 'from-image', resizeWidth: nw, resizeHeight: nh, resizeQuality: 'high' });
    note = `Large image: scaled from ${w}×${h} to ${nw}×${nh} to fit this device's memory.`;
    bmp0.close();
    w = nw;
    h = nh;
  }
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  src = { id: msg.id, w, h, rgba };
  cache.clear();
  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { hasAlpha = true; break; }
  const s = prepared({}).stats;
  self.postMessage({ type: 'loaded', id: msg.id, w, h, otsu: s.thr, midFrac: s.midFrac, paper: s.paper, hasAlpha, note });
}

async function trace(msg) {
  const M = await ready;
  if (!src || src.id !== msg.id) {
    self.postMessage({ type: 'error', job: msg.job, msg: 'Image not loaded.' });
    return;
  }
  const o = msg.opts;
  const { g, stats } = prepared(o);
  const thr = o.autoThr ? stats.thr : o.thr;
  const f = msg.factor;
  const td = Math.max(o.specks > 0 ? 1 : 0, Math.round(o.specks * f * f));
  const t0 = performance.now();
  const p = M._malloc(g.length);
  if (!p) {
    self.postMessage({ type: 'error', job: msg.job, oom: true, msg: 'Out of memory.' });
    return;
  }
  M.HEAPU8.set(g, p);
  let r = 0;
  try {
    r = M._vt_trace(p, src.w, src.h, f, o.resampler, thr, o.invert ? 1 : 0, td, 4, o.alphamax, o.tolerance > 0 ? 1 : 0, o.tolerance, 2);
  } catch (e) {
    self.postMessage({ type: 'error', job: msg.job, oom: true, fatal: true, msg: String(e && e.message || e) });
    return;
  }
  M._free(p);
  if (!r) {
    const code = M._vt_error();
    self.postMessage({ type: 'error', job: msg.job, oom: code === 1, msg: code === 1 ? 'Out of memory.' : 'Tracing failed.' });
    return;
  }
  const d = M.UTF8ToString(r, M._vt_len());
  const out = { type: 'result', job: msg.job, id: msg.id, d, factor: f, thr, paths: M._vt_paths(), segments: M._vt_segments(), ms: performance.now() - t0, w: src.w, h: src.h };
  M._vt_release();
  self.postMessage(out);
}

function run() {
  scheduled = false;
  const m = pending;
  pending = null;
  if (m) trace(m);
}

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'load') {
    load(m).catch(err => self.postMessage({ type: 'loadError', id: m.id, msg: String(err && err.message || err) }));
  } else if (m.type === 'trace') {
    pending = m;
    if (!scheduled) {
      scheduled = true;
      setTimeout(run, 0);
    }
  }
};
