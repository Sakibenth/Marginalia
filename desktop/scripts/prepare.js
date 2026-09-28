'use strict';
/**
 * Builds ./app from the web version of Marginalia (../Marginalia.html by default):
 *  - downloads every CDN library into app/vendor/ and points the page at the local copies
 *  - downloads the Inter + JetBrains Mono fonts (latin) into app/fonts/ so the app works offline
 * Usage: node scripts/prepare.js [path/to/Marginalia.html]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Source page: the path given on the command line, or else the newest Marginalia*.html next to this folder
function newestWebVersion() {
  const dir = path.join(ROOT, '..');
  const hits = fs.readdirSync(dir).filter(f => /^Marginalia.*\.html$/i.test(f))
    .map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!hits.length) throw new Error('No Marginalia*.html found next to this folder; pass its path as an argument');
  return hits[0].f;
}
const SRC = path.resolve(process.argv[2] || newestWebVersion());
const APP = path.join(ROOT, 'app');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const LIBS = [
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdf.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js', 'Readability.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js', 'purify.min.js'],
];

async function get(url, asText) {
  const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA } });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return asText ? res.text() : Buffer.from(await res.arrayBuffer());
}

(async () => {
  let html = fs.readFileSync(SRC, 'utf8');
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(APP, 'fonts'), { recursive: true });

  for (const [url, name] of LIBS) {
    fs.writeFileSync(path.join(APP, 'vendor', name), await get(url));
    if (!html.includes(url)) throw new Error('Expected library not referenced in page: ' + url);
    html = html.split(url).join('vendor/' + name);
    console.log('  vendored', name);
  }

  // Google Fonts -> local @font-face (latin + latin-ext subsets)
  const m = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)" rel="stylesheet">/);
  if (!m) throw new Error('Google Fonts link not found');
  let css = await get(m[1].replace(/&amp;/g, '&'), true);
  const blocks = css.split('/*').slice(1).map(b => '/*' + b).filter(b => /\/\* latin(-ext)? \*\//.test(b));
  let n = 0, out = '';
  for (let b of blocks) {
    const url = (b.match(/url\((https:[^)]+)\)/) || [])[1];
    if (!url) continue;
    const file = 'f' + (n++) + '.woff2';
    fs.writeFileSync(path.join(APP, 'fonts', file), await get(url));
    out += b.replace(url, 'fonts/' + file) + '\n';
  }
  fs.writeFileSync(path.join(APP, 'fonts.css'), out);
  html = html.replace(m[0], '<link href="fonts.css" rel="stylesheet">');
  console.log('  vendored', n, 'font files');

  const leftover = html.match(/https:\/\/(cdnjs|cdn\.jsdelivr|fonts\.googleapis)[^"'\s)]*/g);
  if (leftover) throw new Error('Still referencing CDN: ' + leftover.join(', '));

  fs.writeFileSync(path.join(APP, 'index.html'), html);
  console.log('App prepared from', SRC, '->', APP);
})().catch(e => { console.error('prepare failed:', e.message); process.exit(1); });
