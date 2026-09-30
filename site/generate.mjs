import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PAGES, MODULE, WORKER, ENGINE_DIR, VTRACER_DIR, REPO, RELATED_EXTRA } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, '../../katlab-tools'));
const BASE = 'https://tools.katlab.dev';
const esc = s => s.replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;');
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function writeAsset(name, content) {
  const dest = path.join(out, 'assets', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const cur = fs.readFileSync(dest);
    if (!cur.equals(Buffer.from(content))) throw new Error(`${name} already exists with different content — bump its version (assets are cached immutable)`);
    return;
  }
  fs.writeFileSync(dest, content);
}

const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
writeAsset(MODULE, fs.readFileSync(path.join(here, 'image-to-svg.js'), 'utf8').replace('__WORKER__', WORKER));
writeAsset(WORKER, fs.readFileSync(path.join(here, 'vectorize-worker.js'), 'utf8').replace("'/assets/potrace-r2/", `'/assets/${ENGINE_DIR}/`).replaceAll('__VTRACER__', VTRACER_DIR));
for (const dir of [ENGINE_DIR, VTRACER_DIR]) for (const f of fs.readdirSync(path.join(here, 'assets', dir))) writeAsset(`${dir}/${f}`, fs.readFileSync(path.join(here, 'assets', dir, f)));

for (const p of PAGES) {
  const url = `${BASE}/${p.slug}/`;
  const main = p.slug === 'image-to-svg';
  const crumbs = [{ name: 'katlab tools', item: `${BASE}/` }];
  if (!main) crumbs.push({ name: 'Image to SVG', item: `${BASE}/image-to-svg/` });
  crumbs.push({ name: p.name, item: url });
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'SoftwareApplication', '@id': `${BASE}/${p.slug}#app`, name: `katlab ${p.name}`, url, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web', description: strip(p.appDesc), offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, isPartOf: { '@id': `${BASE}/#website` } },
      { '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) } })) },
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) },
    ],
  };
  const prose = `  <section class="prose">\n    <h2>${esc(p.name)} — questions &amp; answers</h2>\n` +
    p.faq.map(([q, a]) => `    <h3>${esc(q)}</h3>\n    <p>${esc(a)}</p>\n`).join('') + '  </section>\n';
  const siblings = PAGES.filter(x => x.slug !== p.slug).map(x => [`/${x.slug}/`, x.name, strip(x.sub).split(/[.—]/)[0].slice(0, 48)]);
  const rel = [...siblings, ...RELATED_EXTRA].slice(0, 6);
  const related = `\n  <section class="related">\n    <h2>Related tools</h2>\n    <div class="grid">\n` +
    rel.map(([href, t, d]) => `      <a href="${href}"><span class="t">${esc(t)}</span><br><span class="d">${esc(d)}</span></a>\n`).join('') +
    `    </div>\n  </section>\n`;
  const crumb = main ? 'image-to-svg' : `<a href="/image-to-svg/">image-to-svg</a><span class="sep">/</span>${p.slug}`;
  const html = tpl
    .replaceAll('{{TITLE}}', p.title).replaceAll('{{DESC}}', p.desc).replaceAll('{{URL}}', url)
    .replaceAll('{{OG_TITLE}}', p.ogTitle).replaceAll('{{OG_DESC}}', p.ogDesc)
    .replace('{{JSONLD}}', JSON.stringify(ld, null, 2)).replace('{{CRUMB}}', crumb)
    .replace('{{H1}}', p.h1).replace('{{SUB}}', p.sub).replace('{{PROSE}}', prose).replace('{{RELATED}}', related)
    .replace('{{PRESET}}', p.preset).replace('{{MODE}}', p.mode || 'bw').replace('{{UNITS}}', p.units ? ` data-units="${p.units}"` : '')
    .replace('{{MODULE}}', MODULE).replaceAll('{{REPO}}', REPO);
  const left = html.match(/\{\{[A-Z0-9_]+\}\}/);
  if (left) throw new Error(`unfilled placeholder ${left[0]} in ${p.slug}`);
  fs.mkdirSync(path.join(out, p.slug), { recursive: true });
  fs.writeFileSync(path.join(out, p.slug, 'index.html'), html);
  console.log(`wrote ${p.slug}/index.html`);
}
