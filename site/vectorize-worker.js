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
  palCache.clear();
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
  const out = { type: 'result', kind: 'bw', job: msg.job, id: msg.id, d, factor: f, thr, paths: M._vt_paths(), segments: M._vt_segments(), ms: performance.now() - t0, w: src.w, h: src.h };
  M._vt_release();
  self.postMessage(out);
}

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function extractPalette(px, w, h, { maxColors = 24, minFrac = 0.0002, minPx = 24, flatTol = 10, mergeDist = 0.045 } = {}) {
  const bins = new Map();
  let flatCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] < 128) continue;
      let flat = true;
      for (const o of [-4, 4, -w * 4, w * 4]) {
        const j = i + o;
        if (Math.abs(px[j] - px[i]) > flatTol || Math.abs(px[j + 1] - px[i + 1]) > flatTol || Math.abs(px[j + 2] - px[i + 2]) > flatTol) { flat = false; break; }
      }
      if (!flat) continue;
      flatCount++;
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      let b = bins.get(key);
      if (!b) bins.set(key, b = [0, 0, 0, 0]);
      b[0] += px[i]; b[1] += px[i + 1]; b[2] += px[i + 2]; b[3]++;
    }
  }
  const minCount = Math.max(minPx, minFrac * flatCount);
  const cands = [...bins.values()].sort((a, b) => b[3] - a[3]);
  const out = [];
  for (const b of cands) {
    if (b[3] < minCount || out.length >= maxColors) break;
    const c = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const L = oklab(...c);
    let hit = null;
    for (const o of out) { const d = Math.hypot(L[0] - o.L[0], L[1] - o.L[1], L[2] - o.L[2]); if (d < mergeDist) { hit = o; break; } }
    if (hit) { for (let k = 0; k < 3; k++) hit.sum[k] += b[k]; hit.n += b[3]; continue; }
    out.push({ L, sum: [b[0], b[1], b[2]], n: b[3] });
  }
  return out.map(o => '#' + o.sum.map(v => Math.round(v / o.n).toString(16).padStart(2, '0')).join(''));
}
function posterize(px, w, h, palette, { local = 0 } = {}) {
  const P = palette.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  const n = w * h, lab = new Uint8Array(n), out = new Uint8Array(n * 4);
  const d2 = (i, c) => { const a = px[i] - c[0], b = px[i + 1] - c[1], e = px[i + 2] - c[2]; return a * a + b * b + e * e; };
  for (let p = 0; p < n; p++) {
    const i = p * 4; let best = 0, bd = Infinity;
    for (let k = 0; k < P.length; k++) { const d = d2(i, P[k]); if (d < bd) { bd = d; best = k; } }
    lab[p] = best;
  }
  if (local > 0) {
    const conf = new Uint8Array(n);
    for (let p = 0; p < n; p++) { const i = p * 4; conf[p] = px[i + 3] >= 128 && d2(i, P[lab[p]]) < 12 * 12 ? 1 : 0; }
    const lab2 = lab.slice();
    const seen = new Uint8Array(P.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (conf[p] || px[p * 4 + 3] < 128) continue;
      const cand = [];
      for (let yy = Math.max(0, y - local); yy <= Math.min(h - 1, y + local); yy++)
        for (let xx = Math.max(0, x - local); xx <= Math.min(w - 1, x + local); xx++) {
          const q = yy * w + xx; if (conf[q] && !seen[lab[q]]) { seen[lab[q]] = 1; cand.push(lab[q]); }
        }
      for (const k of cand) seen[k] = 0;
      if (cand.length < 2) { if (cand.length === 1) lab2[p] = cand[0]; continue; }
      const i = p * 4; let best = lab[p], bd = Infinity;
      for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
        const A = P[cand[a]], B = P[cand[b]];
        const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
        const L2 = dx * dx + dy * dy + dz * dz || 1;
        let t = ((px[i] - A[0]) * dx + (px[i + 1] - A[1]) * dy + (px[i + 2] - A[2]) * dz) / L2;
        t = Math.min(1, Math.max(0, t));
        const r0 = px[i] - A[0] - t * dx, r1 = px[i + 1] - A[1] - t * dy, r2 = px[i + 2] - A[2] - t * dz;
        const r = r0 * r0 + r1 * r1 + r2 * r2;
        if (r < bd) { bd = r; best = t < 0.5 ? cand[a] : cand[b]; }
      }
      lab2[p] = best;
    }
    lab.set(lab2);
  }
  for (let p = 0; p < n; p++) { const i = p * 4; if (px[i + 3] < 128) continue; const c = P[lab[p]]; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; }
  return out;
}

let vtPromise = null;
function vtracer() {
  if (!vtPromise) vtPromise = import('/assets/__VTRACER__/vtracer.js').then(async m => { await m.default({ module_or_path: '/assets/__VTRACER__/vtracer_bg.wasm' }); return m; });
  return vtPromise;
}
const palCache = new Map();

function scaledPixels(scale) {
  const W = Math.max(1, Math.round(src.w * scale)), H = Math.max(1, Math.round(src.h * scale));
  if (W === src.w && H === src.h) return { W, H, rgba: new Uint8ClampedArray(src.rgba) };
  const base = new OffscreenCanvas(src.w, src.h);
  base.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.rgba), src.w, src.h), 0, 0);
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, W, H);
  return { W, H, rgba: g.getImageData(0, 0, W, H).data };
}

async function traceColor(msg) {
  const o = msg.opts;
  const vt = await vtracer();
  const t0 = performance.now();
  const s = msg.factor;
  const { W, H, rgba } = scaledPixels(s);
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 128) rgba[i] = 0;
  let input = rgba, options, palette = null;
  if (o.cpreset === 'poster') {
    options = { preset: 'poster', filterSpeckle: Math.max(1, Math.round(o.cspecks)), hierarchical: o.layering, pathPrecision: 1 };
    if (o.csmooth > 0) options.simplify = o.csmooth;
  } else {
    const key = o.colors;
    palette = palCache.get(key);
    if (!palette) { palette = extractPalette(src.rgba, src.w, src.h, { maxColors: o.colors, mergeDist: 0.02 }); palCache.set(key, palette); }
    if (!palette.length) palette = ['#000000'];
    self.postMessage({ type: 'progress', p: 0.1 });
    input = posterize(rgba, W, H, palette, { local: Math.max(1, Math.round(2 * s)) });
    options = { palette, filterSpeckle: Math.max(1, Math.round(o.cspecks * s)), cornerThreshold: o.corner, hierarchical: o.layering, mode: 'spline', pathPrecision: 1 };
    if (o.csmooth > 0) options.simplify = o.csmooth * s;
  }
  self.postMessage({ type: 'progress', p: 0.2 });
  const phases = { segment: [0.2, 0.7], compose: [0.7, 0.9], optimize: [0.9, 1] };
  const svg = vt.vectorize_rgba(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), W, H, options, (ph, f) => {
    const r = phases[ph] || [0.2, 1];
    self.postMessage({ type: 'progress', p: r[0] + (r[1] - r[0]) * f });
  });
  const paths = [];
  const re = /<path\b[^>]*?\bd="([^"]+)"[^>]*?\bfill="(#[0-9a-fA-F]{6})"[^>]*>|<path\b[^>]*?\bfill="(#[0-9a-fA-F]{6})"[^>]*?\bd="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(svg))) paths.push(m[1] ? { d: m[1], fill: m[2].toLowerCase() } : { d: m[4], fill: m[3].toLowerCase() });
  const colors = new Set(paths.map(p => p.fill)).size;
  self.postMessage({ type: 'result', kind: 'color', job: msg.job, id: msg.id, paths, colors, palette, W, H, factor: s, w: src.w, h: src.h, count: paths.length, ms: performance.now() - t0 });
}

function run() {
  scheduled = false;
  const m = pending;
  pending = null;
  if (!m) return;
  if (m.opts && m.opts.mode === 'color') {
    if (!src || src.id !== m.id) { self.postMessage({ type: 'error', job: m.job, msg: 'Image not loaded.' }); return; }
    traceColor(m).catch(e => {
      const msg = String(e && e.message || e);
      self.postMessage({ type: 'error', job: m.job, fatal: e instanceof WebAssembly.RuntimeError || /unreachable|memory/i.test(msg), oom: /memory|allocation/i.test(msg), msg: 'Colour tracing failed: ' + msg });
    });
  } else trace(m);
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
