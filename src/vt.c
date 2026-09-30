#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "potracelib.h"

EM_JS(void, vt_progress, (double p), {
  if (typeof self !== 'undefined' && self.postMessage && typeof WorkerGlobalScope !== 'undefined') self.postMessage({ type: 'progress', p: p });
});

static double sinc(double x) {
  if (x == 0.0) return 1.0;
  x *= M_PI;
  return sin(x) / x;
}

static double f_lanczos(double x) { return (-3.0 <= x && x < 3.0) ? sinc(x) * sinc(x / 3.0) : 0.0; }

static double f_bicubic(double x) {
  const double a = -0.5;
  if (x < 0.0) x = -x;
  if (x < 1.0) return ((a + 2.0) * x - (a + 3.0)) * x * x + 1;
  if (x < 2.0) return (((x - 5) * x + 8) * x - 4) * a;
  return 0.0;
}

static double f_box(double x) { return (x > -0.5 && x <= 0.5) ? 1.0 : 0.0; }

typedef struct {
  int *start;
  int *count;
  double *k;
  int ksize;
} coeffs;

static int make_coeffs(coeffs *c, int in, int out, int kind) {
  double (*fn)(double) = kind == 0 ? f_lanczos : kind == 1 ? f_bicubic : f_box;
  double sup = kind == 0 ? 3.0 : kind == 1 ? 2.0 : 0.5;
  double scale = (double)in / out;
  double fscale = scale < 1.0 ? 1.0 : scale;
  double support = sup * fscale;
  int ksize = (int)ceil(support) * 2 + 1;
  c->ksize = ksize;
  c->start = malloc(sizeof(int) * out);
  c->count = malloc(sizeof(int) * out);
  c->k = malloc(sizeof(double) * out * ksize);
  if (!c->start || !c->count || !c->k) return 0;
  for (int xx = 0; xx < out; xx++) {
    double center = (xx + 0.5) * scale;
    double ss = 1.0 / fscale, ww = 0.0;
    int xmin = (int)(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    int xmax = (int)(center + support + 0.5);
    if (xmax > in) xmax = in;
    xmax -= xmin;
    double *k = c->k + (size_t)xx * ksize;
    for (int x = 0; x < xmax; x++) {
      double w = fn((x + xmin - center + 0.5) * ss);
      k[x] = w;
      ww += w;
    }
    for (int x = 0; x < xmax; x++)
      if (ww != 0.0) k[x] /= ww;
    c->start[xx] = xmin;
    c->count[xx] = xmax;
  }
  return 1;
}

static void free_coeffs(coeffs *c) {
  free(c->start);
  free(c->count);
  free(c->k);
}

static char *out_buf = NULL;
static size_t out_len = 0, out_cap = 0;
static int last_paths = 0, last_segments = 0, last_w = 0, last_h = 0, last_error = 0;

static int put(const char *s, size_t n) {
  if (out_len + n + 1 > out_cap) {
    size_t cap = out_cap ? out_cap * 2 : 1 << 20;
    while (cap < out_len + n + 1) cap *= 2;
    char *b = realloc(out_buf, cap);
    if (!b) return 0;
    out_buf = b;
    out_cap = cap;
  }
  memcpy(out_buf + out_len, s, n);
  out_len += n;
  out_buf[out_len] = 0;
  return 1;
}

static int num(double v, double inv, int prec) {
  char tmp[48];
  int n = snprintf(tmp, sizeof tmp, "%.*f", prec, v * inv);
  if (prec > 0) {
    while (n > 0 && tmp[n - 1] == '0') n--;
    if (n > 0 && tmp[n - 1] == '.') n--;
  }
  if (n == 2 && tmp[0] == '-' && tmp[1] == '0') { tmp[0] = '0'; n = 1; }
  return put(tmp, n);
}

static int pt(char cmd, potrace_dpoint_t p, double inv, int prec) {
  char c[2] = {cmd, 0};
  if (cmd && !put(c, 1)) return 0;
  if (!num(p.x, inv, prec) || !put(" ", 1) || !num(p.y, inv, prec)) return 0;
  return 1;
}

EMSCRIPTEN_KEEPALIVE int vt_paths(void) { return last_paths; }
EMSCRIPTEN_KEEPALIVE int vt_segments(void) { return last_segments; }
EMSCRIPTEN_KEEPALIVE int vt_out_w(void) { return last_w; }
EMSCRIPTEN_KEEPALIVE int vt_out_h(void) { return last_h; }
EMSCRIPTEN_KEEPALIVE int vt_error(void) { return last_error; }
EMSCRIPTEN_KEEPALIVE size_t vt_len(void) { return out_len; }

static void prog_cb(double p, void *d) {
  (void)d;
  vt_progress(p);
}

EMSCRIPTEN_KEEPALIVE char *vt_trace(const unsigned char *gray, int w, int h, int factor, int kind,
                                    double threshold, int invert, int turdsize, int turnpolicy,
                                    double alphamax, int opticurve, double opttolerance, int prec) {
  last_error = 0;
  last_paths = last_segments = 0;
  out_len = 0;
  int W = w * factor, H = h * factor;
  last_w = W;
  last_h = H;
  coeffs cx, cy;
  memset(&cx, 0, sizeof cx);
  memset(&cy, 0, sizeof cy);
  float *tmp = NULL;
  float *row = NULL;
  potrace_bitmap_t bm;
  bm.map = NULL;
  potrace_state_t *st = NULL;
  potrace_param_t *param = NULL;

  if (!make_coeffs(&cx, w, W, kind) || !make_coeffs(&cy, h, H, kind)) { last_error = 1; goto done; }
  tmp = malloc(sizeof(float) * (size_t)W * h);
  row = malloc(sizeof(float) * (size_t)W);
  if (!tmp || !row) { last_error = 1; goto done; }
  for (int y = 0; y < h; y++) {
    const unsigned char *src = gray + (size_t)y * w;
    float *dst = tmp + (size_t)y * W;
    for (int xx = 0; xx < W; xx++) {
      const double *k = cx.k + (size_t)xx * cx.ksize;
      int s = cx.start[xx], n = cx.count[xx];
      double acc = 0.0;
      for (int i = 0; i < n; i++) acc += src[s + i] * k[i];
      dst[xx] = (float)acc;
    }
  }
  vt_progress(0.15);

  bm.w = W;
  bm.h = H;
  bm.dy = (W + 31) / 32;
  bm.map = calloc((size_t)bm.dy * H, sizeof(potrace_word));
  if (!bm.map) { last_error = 1; goto done; }
  double thr = threshold * 255.0;
  for (int yy = 0; yy < H; yy++) {
    const double *k = cy.k + (size_t)yy * cy.ksize;
    int s = cy.start[yy], n = cy.count[yy];
    for (int xx = 0; xx < W; xx++) row[xx] = 0.0f;
    for (int i = 0; i < n; i++) {
      const float *r = tmp + (size_t)(s + i) * W;
      float kk = (float)k[i];
      for (int xx = 0; xx < W; xx++) row[xx] += r[xx] * kk;
    }
    potrace_word *line = bm.map + (size_t)yy * bm.dy;
    for (int xx = 0; xx < W; xx++) {
      int ink = invert ? (row[xx] >= thr) : (row[xx] < thr);
      if (ink) line[xx >> 5] |= ((potrace_word)1) << (31 - (xx & 31));
    }
    if ((yy & 255) == 0) vt_progress(0.15 + 0.2 * yy / H);
  }
  free(tmp);
  tmp = NULL;
  free(row);
  row = NULL;
  free_coeffs(&cx);
  free_coeffs(&cy);
  memset(&cx, 0, sizeof cx);
  memset(&cy, 0, sizeof cy);

  param = potrace_param_default();
  if (!param) { last_error = 1; goto done; }
  param->turdsize = turdsize;
  param->turnpolicy = turnpolicy;
  param->alphamax = alphamax;
  param->opticurve = opticurve;
  param->opttolerance = opttolerance;
  param->progress.callback = prog_cb;
  param->progress.min = 0.35;
  param->progress.max = 0.95;
  param->progress.epsilon = 0.02;
  st = potrace_trace(param, &bm);
  free(bm.map);
  bm.map = NULL;
  if (!st || st->status != POTRACE_STATUS_OK) { last_error = 2; goto done; }

  double inv = 1.0 / factor;
  for (potrace_path_t *p = st->plist; p; p = p->next) {
    potrace_curve_t *c = &p->curve;
    int n = c->n;
    if (n <= 0) continue;
    last_paths++;
    last_segments += n;
    if (!pt('M', c->c[n - 1][2], inv, prec)) { last_error = 1; goto done; }
    for (int i = 0; i < n; i++) {
      if (c->tag[i] == POTRACE_CURVETO) {
        if (!pt('C', c->c[i][0], inv, prec) || !pt(' ', c->c[i][1], inv, prec) || !pt(' ', c->c[i][2], inv, prec)) { last_error = 1; goto done; }
      } else {
        if (!pt('L', c->c[i][1], inv, prec) || !pt('L', c->c[i][2], inv, prec)) { last_error = 1; goto done; }
      }
    }
    if (!put("Z", 1)) { last_error = 1; goto done; }
  }
  if (!out_buf && !put("", 0)) last_error = 1;
  vt_progress(1.0);

done:
  free(tmp);
  free(row);
  free(bm.map);
  if (cx.start) free_coeffs(&cx);
  if (cy.start) free_coeffs(&cy);
  if (st) potrace_state_free(st);
  if (param) potrace_param_free(param);
  if (last_error) return NULL;
  return out_buf;
}

EMSCRIPTEN_KEEPALIVE void vt_release(void) {
  free(out_buf);
  out_buf = NULL;
  out_len = out_cap = 0;
}
