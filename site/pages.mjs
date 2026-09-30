export const MODULE = 'image-to-svg-v1.js';
export const WORKER = 'vectorize-worker-v2.js';
export const ENGINE_DIR = 'potrace-r2';
export const REPO = 'https://github.com/nejc-katlab/katlab-image-to-svg';

const common = {
  privacy: ['Is my image uploaded to a server?', 'No. Decoding, tracing and exporting all happen on your device, and nothing is uploaded. Once the page has loaded it works offline.'],
  engine: ['What does it use under the hood, and is it open source?', 'Tracing is done by Potrace by Peter Selinger, compiled to WebAssembly. Potrace is licensed under the GPL, and the full source code of this tool is published on GitHub.'],
};

export const PAGES = [
  {
    slug: 'image-to-svg',
    name: 'Image to SVG',
    title: 'Image to SVG — Trace Line Art, Sketches &amp; Logos | katlab tools',
    desc: 'Free image to SVG converter. Trace line art, sketches, lettering and one-colour logos into clean vector SVG, print-ready PDF or DXF — 100% in your browser. No uploads, no accounts, no tracking.',
    ogTitle: 'Image to SVG — Trace Line Art Free &amp; Private',
    ogDesc: 'Trace line art, sketches and one-colour logos into clean SVG, PDF or DXF, entirely in your browser. No uploads, no accounts.',
    h1: 'Image to SVG <span class="pipe">|</span> trace line art',
    sub: 'Turn line art, sketches, lettering, stamps and one-colour logos into a clean vector SVG, a print-ready PDF or a DXF for cutting machines. Black-and-white tracing that stays faithful to the original — every setting is yours to adjust.',
    appDesc: 'Free image to SVG tracer that runs entirely in your browser. Turns line art, sketches, lettering and one-colour logos into clean vector SVG, print-ready PDF or DXF, with batch conversion. No uploads, no accounts, no tracking.',
    preset: 'ink',
    faq: [
      ['How do I convert an image to SVG?', 'Drop your image, pick a preset, and adjust the threshold and detail while the preview updates. When the trace looks right, download it as SVG, PDF or DXF. Everything runs in your browser.'],
      ['What kind of images work best?', 'Line art and coloring pages, pen and pencil sketches, hand lettering and calligraphy, stamps, signatures and one-colour logos. This is a black-and-white (single colour) tracer, so colour logos and photographs are reduced to ink and paper.'],
      ['How accurate is the trace?', 'The image is upscaled up to 8× with a Lanczos filter before tracing, so the soft anti-aliased edges become precise sub-pixel positions. Typically less than 1% of pixels differ from the original, and those differences are edge shading. The Differences view shows exactly where.'],
      ['Can I make a print-ready PDF or convert many images at once?', 'Yes. Export a vector PDF sized to US Letter, A4, A5, 8×10 or 8.5×8.5 inches with a margin you choose. Drop several images to download them all as SVGs or DXFs in a zip, or as one multi-page PDF — for example a coloring book interior.'],
      common.privacy,
      common.engine,
    ],
  },
  {
    slug: 'png-to-svg',
    name: 'PNG to SVG',
    title: 'PNG to SVG Converter — Free, Private, No Upload | katlab tools',
    desc: 'Convert PNG to SVG free in your browser. Trace line art, icons, lettering and one-colour logos from PNG into clean, scalable vector SVG — transparency supported, nothing uploaded.',
    ogTitle: 'PNG to SVG Converter — Free &amp; Private',
    ogDesc: 'Trace a PNG into a clean, scalable SVG right in your browser. Transparent PNGs supported. Nothing is uploaded.',
    h1: 'PNG to SVG <span class="pipe">|</span> converter',
    sub: 'Turn a PNG into a real vector SVG — smooth Bézier curves you can scale to any size, not a PNG wrapped in an SVG file. Works with transparent PNGs, runs entirely in your browser.',
    appDesc: 'Free PNG to SVG converter that traces PNG line art, icons, lettering and one-colour logos into scalable vector SVG in the browser. Transparent PNGs supported. No uploads.',
    preset: 'ink',
    faq: [
      ['How do I convert a PNG to SVG?', 'Drop the PNG onto the page. It is traced into vector curves straight away; adjust the threshold or detail if needed and download the SVG. You can also export PDF or DXF.'],
      ['Is the result a real vector, or just the PNG embedded in an SVG?', 'A real vector. Many online converters simply embed the PNG pixels inside an SVG file, which still blurs when enlarged. This tool traces the shapes into Bézier paths, so the SVG stays sharp at any size and can be edited in Illustrator, Inkscape, Figma or Cricut Design Space.'],
      ['Does it work with transparent PNGs?', 'Yes. Transparent areas are treated as white paper by default. If your artwork is drawn as transparency on a coloured background — or you want the transparent shape itself — turn on “Transparency is ink” under Advanced.'],
      ['What PNGs give the best result?', 'Black-and-white or one-colour artwork: line art, icons, lettering, stamps and logos. Colour images are reduced to a single ink colour, so this is not the tool for photographs.'],
      common.privacy,
    ],
  },
  {
    slug: 'jpg-to-svg',
    name: 'JPG to SVG',
    title: 'JPG to SVG Converter — Trace JPEG to Vector Free | katlab tools',
    desc: 'Convert JPG or JPEG to SVG free in your browser. Trace sketches, scans, line art and one-colour logos into clean vector SVG — with scan clean-up for photos of paper. Nothing uploaded.',
    ogTitle: 'JPG to SVG Converter — Free &amp; Private',
    ogDesc: 'Trace a JPG or JPEG into clean vector SVG in your browser, with clean-up for scans and phone photos. Nothing is uploaded.',
    h1: 'JPG to SVG <span class="pipe">|</span> converter',
    sub: 'Trace a JPG or JPEG — a scan, a phone photo of a drawing, or a saved logo — into clean vector curves. Built-in clean-up evens out paper lighting and removes JPEG noise before tracing.',
    appDesc: 'Free JPG to SVG converter that traces JPEG sketches, scans, line art and one-colour logos into vector SVG in the browser, with lighting correction and denoise for photos of paper. No uploads.',
    preset: 'ink',
    faq: [
      ['How do I convert a JPG to SVG?', 'Drop the JPG or JPEG onto the page, pick a preset and download the SVG. If the image is a photo or scan of paper, the tool suggests the “Scan / photo of paper” preset, which fixes uneven lighting before tracing.'],
      ['My JPG has grey blotches and noise around the lines — what helps?', 'JPEG compression adds faint artefacts around dark lines. Raise “Remove specks”, turn on Denoise under Advanced, or nudge the threshold. The Differences view shows exactly what the trace kept and dropped.'],
      ['Can it trace a phone photo of a drawing?', 'Yes. Use the “Scan / photo of paper” preset: it divides out the uneven lighting and shadows of the paper, then picks the threshold automatically. For the cleanest result, photograph the drawing flat and in even light.'],
      ['Is the SVG a real vector?', 'Yes — the shapes are traced into Bézier paths, not embedded as a picture, so the SVG stays sharp at any size and can be edited or cut.'],
      common.privacy,
    ],
  },
  {
    slug: 'line-art-to-svg',
    name: 'Line Art to SVG',
    title: 'Line Art to SVG — Vectorize Drawings &amp; Coloring Pages | katlab tools',
    desc: 'Vectorize line art, ink drawings and coloring pages into SVG or print-ready PDF. Faithful tracing that keeps your line weight, batch export to one book PDF — free and private, in your browser.',
    ogTitle: 'Line Art to SVG — Vectorize Drawings Free',
    ogDesc: 'Turn line art and coloring pages into crisp SVG or print-ready PDF, keeping your line weight. Batch to one book PDF. Nothing is uploaded.',
    h1: 'Line art to SVG <span class="pipe">|</span> vectorize drawings',
    sub: 'Vectorize ink drawings, comics and coloring pages without changing your line work: tapered strokes, line weight and small details are kept. Export SVG, or a print-ready PDF — one page or a whole book at once.',
    appDesc: 'Free line art vectorizer that turns ink drawings and coloring pages into SVG or print-ready PDF in the browser, keeping line weight, with batch export to one multi-page PDF. No uploads.',
    preset: 'ink',
    faq: [
      ['Will it change my line work?', 'No. The tracer follows the edges of your ink as closely as possible — upscaling up to 8× before tracing so edges land on sub-pixel positions — and does not redraw, thicken or smooth your strokes. On clean digital line art typically less than 1% of pixels differ from the original, and that is edge shading.'],
      ['Can I prepare a coloring book for print?', 'Yes. Drop all the pages at once, choose the page size (US Letter, 8.5×8.5, 8×10, A4 or A5) and margin, and download “All as one PDF”: a vector PDF with one traced page per image, ready as a book interior.'],
      ['Should I export at a higher resolution first?', 'If you have it, yes. Export your drawing at full resolution as PNG from your drawing app. Screenshots, messaging apps and heavy compression add noise around lines that the tracer will faithfully copy.'],
      ['Does it work with pencil sketches and scans?', 'Yes. The “Scan / photo of paper” preset corrects uneven paper lighting and noise before tracing. Very light or sketchy pencil lines may need the threshold raised.'],
      common.privacy,
    ],
  },
  {
    slug: 'image-to-dxf',
    name: 'Image to DXF',
    title: 'Image to DXF Converter — PNG &amp; JPG to DXF for Laser &amp; CNC | katlab tools',
    desc: 'Convert PNG or JPG to DXF free in your browser. Trace line art, logos and silhouettes into closed DXF outlines for laser cutters, CNC, plotters and Cricut — sized in mm or inches. Nothing uploaded.',
    ogTitle: 'Image to DXF — PNG &amp; JPG to DXF, Free',
    ogDesc: 'Trace images into closed DXF outlines for laser, CNC and plotters, sized in mm or inches — right in your browser.',
    h1: 'Image to DXF <span class="pipe">|</span> for laser &amp; CNC',
    sub: 'Trace a PNG or JPG into closed vector outlines and download a DXF for laser cutters, CNC routers, plotters and cutting machines — sized in millimetres or inches, with an SVG and PDF of the same trace.',
    appDesc: 'Free image to DXF converter that traces PNG and JPG line art, logos and silhouettes into closed DXF polylines for laser cutting, CNC and plotters, sized in mm or inches, in the browser. No uploads.',
    preset: 'logo',
    units: 'mm',
    faq: [
      ['How do I convert an image to DXF?', 'Drop the image, check the trace in the preview, set “SVG / DXF size” to millimetres or inches and the width you want, then click Download DXF. Several images can be exported as a zip of DXFs.'],
      ['Which programs can open the DXF?', 'The DXF uses the classic R12 format with closed polylines, which LightBurn, RDWorks, Inkscape, AutoCAD, Fusion, FreeCAD, LibreCAD and most CNC and plotter software read.'],
      ['Are the outlines closed and to scale?', 'Yes. Every shape is a closed polyline, curves are approximated to within 0.1 pixel of the original image, and coordinates are in the millimetres or inches you choose (or pixels if you leave the size in pixels).'],
      ['What images work best for laser cutting and engraving?', 'High-contrast artwork: logos, silhouettes, lettering, stamps and line art. Colour photos are reduced to black and white, so simplify them first. Raise “Remove specks” to drop tiny islands that would be wasted cuts.'],
      common.privacy,
    ],
  },
];

export const RELATED_EXTRA = [
  ['/svg-optimizer/', 'SVG Optimizer', 'Minify SVG with SVGO'],
  ['/svg-to-png/', 'SVG to PNG', 'Rasterize SVG at any size'],
  ['/images-to-pdf/', 'Images to PDF', 'Combine images into one PDF'],
];
