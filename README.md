# katlab Image to SVG

Source code of **[tools.katlab.dev/image-to-svg](https://tools.katlab.dev/image-to-svg/)**, a free, fully client-side vectorizer. It turns line art, sketches, lettering and logos, in black and white or colour, into vector SVG, print-ready PDF or DXF. Images never leave the browser.

Black-and-white tracing uses [Potrace](https://potrace.sourceforge.net/) 1.16 by Peter Selinger. Colour tracing uses [VTracer](https://github.com/visioncortex/vtracer) 1.0.0-alpha.4 by VisionCortex (MIT). Both are compiled to WebAssembly. Potrace is GPL-2.0-or-later, and so is this repository; see [LICENSE](LICENSE). The VTracer wrapper in `vtracer/` builds on MIT-licensed VTracer.

## How it works

1. The worker decodes the image and converts it to 8-bit greyscale, flattening alpha onto white. Optional steps are lighting correction, denoise, or treating transparency as ink.
2. `src/vt.c` upscales the greyscale image by up to 8×.
   - It streams a separable Lanczos-3 filter (bicubic and box are also available) band by band, then thresholds the result straight into Potrace's packed 1-bit bitmap.
   - The upscaled image is never held in memory at full size: 8× of a 1 MP page is a 68 MP bitmap, which is only 8.5 MB.
   - The upscale turns anti-aliased edges into sub-pixel edge positions.
3. Potrace traces the bitmap into Bézier curves. `vt.c` serialises them directly into an SVG path `d` string, in source-pixel coordinates.

On a clean 864×1226 coloring page at 8×, the trace takes about 0.2–0.5 s and differs from the original by about 0.8% mean absolute difference, which is edge shading.

## Colour mode

VTracer on its own collapses anti-aliased edges and JPEG noise into many in-between colours, so the worker prepares the image first:

1. It picks the palette from the flat regions of the 1× image, using 5-bit RGB bins merged in OKLab. Those are the image's real colours.
2. It upscales up to 4× on an `OffscreenCanvas` with `imageSmoothingQuality: 'high'`.
3. It snaps every pixel to that palette. An edge pixel between two palette colours goes to whichever it is closer to, which puts the edge on the 50% line, like the black-and-white threshold.
4. VTracer traces with that fixed `palette`, using stacked layers and splines. `filterSpeckle` and `simplify` are scaled by the upscale factor.
5. The result gets a `viewBox`, so it displays at the source size.

On flat-colour test logos this reproduces the source colours exactly: a 9-shape logo becomes 9 paths, and about 0.2% of pixels are visibly off. The Poster preset (photos) skips the palette step and traces at about 2 MP or less with VTracer's `poster` preset.

## Files

| Path | What it is |
|---|---|
| `upstream/potrace-1.16.tar.gz` | Unmodified upstream Potrace 1.16 source. SHA-256 `be8248a17dedd6ccbaab2fcc45835bb0502d062e40fbded3bc56028ce5eb7acc` |
| `src/vt.c` | WebAssembly glue: streaming resample and threshold, Potrace call, path serialisation, progress |
| `build.sh` | Builds `dist/potrace-v1.{js,wasm}` |
| `site/assets/potrace-r2/` | The exact Potrace engine files deployed on tools.katlab.dev |
| `vtracer/` | Rust wrapper crate exposing `vectorize_rgba(rgba, w, h, options, onProgress)` to JavaScript |
| `build-vtracer.sh` | Builds `dist/vtracer-v2/vtracer{.js,_bg.wasm}` from VTracer commit `2500df76b5aea0ac22d15296b22722442f825c5b` |
| `site/assets/vtracer-v2/` | The exact VTracer engine files deployed on tools.katlab.dev |
| `site/vectorize-worker.js` | Module worker: decoding, pre-processing, Otsu threshold, engine calls |
| `site/image-to-svg.js` | Page module: UI, preview, compare view, and SVG, PDF, DXF and zip export |
| `site/template.html` | Page template shared by the tool and its landing pages |
| `site/pages.mjs` | Page definitions (copy, FAQ, default preset) and the versioned asset names |
| `site/generate.mjs` | Writes every page plus the versioned assets into a tools-site checkout |
| `test/golden.mjs` | Node harness that traces a raw 8-bit greyscale file |

## Generating the pages

```sh
node site/generate.mjs ../katlab-tools
```

This writes `/<slug>/index.html` for every entry in `site/pages.mjs`. It also writes the module, the worker and the engine into `assets/` under the versioned names set in `pages.mjs`. Assets are served with an immutable one-year cache, so the generator refuses to overwrite an existing asset with different content. When you change the module or the worker, bump its name.

## DXF export

- Traced Bézier curves are flattened into closed polylines, to within 0.1 source pixel.
- The file is DXF R12 (`AC1009`), which almost every CAD, laser, CNC and plotter program reads.
- Units follow the "SVG / DXF size" setting: millimetres, inches, or unitless pixels.

## Building

You need [emsdk](https://github.com/emscripten-core/emsdk) **6.0.10**, the version used for the deployed files.

```sh
./emsdk install 6.0.10 && ./emsdk activate 6.0.10 && source ./emsdk_env.sh
./build.sh
```

The output in `dist/` is byte-identical to `site/assets/potrace-r2/`.

For the Node test build:

```sh
ENVIRONMENT=worker,node OUT=dist-node ./build.sh
node test/golden.mjs image.raw <width> <height> [factor] [out.svg]
```

The generated glue contains no `eval` or `new Function`, because the build uses `-sDYNAMIC_EXECUTION=0` and no embind. It therefore runs under a strict CSP that allows only `'wasm-unsafe-eval'`.

### VTracer

You need rustup with Rust **1.98.1**, the `wasm32-unknown-unknown` target, and wasm-pack **0.14.0**. `vtracer/Cargo.lock` pins wasm-bindgen 0.2.129.

```sh
./build-vtracer.sh
```

The script clones VTracer at the pinned commit into `build/`. It remaps local paths to `/cargo` and `/src`, so no machine-specific paths end up in the wasm, and it checks that the glue contains no `eval` or `new Function`. With the same toolchain, the output matches `site/assets/vtracer-v2/`.

## Third-party code

The page loads [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) and [fflate](https://github.com/101arrowz/fflate) (MIT) from the tools site's own `/assets/` for PDF and zip export. They are not included here.
