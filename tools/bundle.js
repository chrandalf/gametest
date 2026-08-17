#!/usr/bin/env node
// Inlines every <script src> into index.html to produce one self-contained page
// that can be emailed, dropped on a static host, or opened straight from disk.
//
//   node tools/bundle.js [outfile]      (default: dist/nightfall-city.html)
//
// The output deliberately omits <!doctype>/<html>/<head>/<body>: browsers supply
// them, and embedding hosts that wrap the file in their own skeleton stay happy.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'nightfall-city.html');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Pull the interesting bits out of the page shell.
const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`bundle: could not find ${label} in index.html`);
  return m[1];
};
const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const style = pick(/<style>([\s\S]*?)<\/style>/, '<style>');
const body = pick(/<body>([\s\S]*?)<script/, '<body> markup');

const sources = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!sources.length) throw new Error('bundle: no <script src> tags found');

// Character sheets, base64-inlined. The whole point of this build is one file
// with nothing beside it, so a PNG dropped into assets/characters travels
// inside the page rather than as a request the page cannot make from disk.
const charDir = path.join(root, 'assets', 'characters');
const sheets = [];
if (fs.existsSync(charDir)) {
  for (const f of fs.readdirSync(charDir).sort()) {
    const m = f.match(/^(\d+)\.png$/i);
    if (!m) continue;
    const data = fs.readFileSync(path.join(charDir, f)).toString('base64');
    sheets.push(`  ${Number(m[1])}: "data:image/png;base64,${data}"`);
  }
}
const spriteBlob = sheets.length
  ? `<script>\nwindow.CHARACTER_SHEET_SRC = {\n${sheets.join(',\n')}\n};\n</script>\n`
  : '';

const scripts = sources.map((src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  // A literal </script> inside a string would close the tag early.
  return `<script>\n// ---- ${src} ----\n${code.replace(/<\/script>/gi, '<\\/script>')}\n</script>`;
}).join('\n');

const bundle = `<title>${title}</title>
<style>
${style.trim()}
</style>
${body.trim()}
${spriteBlob}${scripts}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024).toFixed(0)} KB  ` +
            `(${sources.length} scripts, ${sheets.length} character sheets inlined)`);
