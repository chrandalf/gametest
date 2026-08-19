#!/usr/bin/env node
// Inlines every <script src> into index.html to produce one self-contained page
// that can be emailed, dropped on a static host, or opened straight from disk.
//
//   node tools/bundle.js [outfile]      (default: dist/neon-drive.html)
//
// The output deliberately omits <!doctype>/<html>/<head>/<body>: browsers supply
// them, and embedding hosts that wrap the file in their own skeleton stay happy.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'neon-drive.html');

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
// Always emitted, even empty: the loader treats its presence as "everything
// is inlined", so a bundle with no sheets stops probing assets/characters/
// on disk and filling the console with eight 404s at every boot.
const spriteBlob =
  `<script>\nwindow.CHARACTER_SHEET_SRC = {\n${sheets.join(',\n')}\n};\n</script>\n`;

const scripts = sources.map((src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  // A literal </script> inside a string would close the tag early.
  return `<script>\n// ---- ${src} ----\n${code.replace(/<\/script>/gi, '<\\/script>')}\n</script>`;
}).join('\n');

// The soundtrack, inlined the same way. Licensed audio the owner dropped in
// assets/music travels inside the page; if it would push the page past the
// 16 MB artifact ceiling, tracks are dropped largest-first until it fits.
const MAX_PAGE = 15.6 * 1024 * 1024;
const musicDir = path.join(root, 'assets', 'music');
let music = [];
if (fs.existsSync(musicDir)) {
  for (const f of fs.readdirSync(musicDir).sort()) {
    const m = f.match(/^(\d+)\.mp3$/i);
    if (!m) continue;
    const raw = fs.readFileSync(path.join(musicDir, f));
    music.push({ id: Number(m[1]), b64: raw.toString('base64') });
  }
}
const baseSize = () =>
  music.reduce((s, t) => s + t.b64.length + 60, 0);
let dropped = 0;
while (music.length && baseSize() > MAX_PAGE - 800 * 1024) {
  music.sort((a, b) => a.b64.length - b.b64.length);
  music.pop();
  dropped++;
}
music.sort((a, b) => a.id - b.id);
const musicBlob = music.length
  ? `<script>\nwindow.MUSIC_SRC = {\n${music.map((t) =>
      `  ${t.id}: "data:audio/mpeg;base64,${t.b64}"`).join(',\n')}\n};\n</script>\n`
  : '';

// No <head> wrapper, but the charset must still be declared: opened straight
// from disk with no server headers, a browser left to guess the encoding
// turns every em-dash and midpoint in the HUD into mojibake.
const bundle = `<meta charset="utf-8">
<title>${title}</title>
<style>
${style.trim()}
</style>
${body.trim()}
${spriteBlob}${musicBlob}${scripts}
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024 / 1024).toFixed(2)} MB  ` +
            `(${sources.length} scripts, ${sheets.length} character sheets, ` +
            `${music.length} music tracks inlined${dropped ? `, ${dropped} dropped for size` : ''})`);
