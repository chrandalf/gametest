#!/usr/bin/env node
// Inlines the sequel tech demo into one self-contained page:
//   node tools/bundle-sequel.js   ->  dist/neon-drive-2.html
//
// The engine is a tree-shaken @babylonjs/core build (see sequel/src/main.mjs
// + esbuild), inlined raw: the artifact viewer's CSP has no 'unsafe-eval',
// so it must be a real inline script, and shaking out the unused engine
// modules keeps the page small.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'neon-drive-2.html');
const seq = path.join(root, 'sequel');

execSync('npx esbuild src/main.mjs --bundle --minify --format=iife --outfile=vendor/engine.js',
         { cwd: seq, stdio: 'pipe' });

const html = fs.readFileSync(path.join(seq, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(seq, 'vendor', 'engine.js'), 'utf8');

// The soundtrack, inlined as data URIs - the same licensed tracks Neon
// Drive 1 carries. If the page would breach the 16 MB artifact ceiling,
// tracks are dropped largest-first until it fits.
const MAX_PAGE = 15.4 * 1024 * 1024;
const musicDir = path.join(root, 'assets', 'music');
let music = [];
if (fs.existsSync(musicDir)) {
  for (const f of fs.readdirSync(musicDir).sort()) {
    const mm = f.match(/^(\d+)\.mp3$/i);
    if (!mm) continue;
    music.push({ id: Number(mm[1]),
                 b64: fs.readFileSync(path.join(musicDir, f)).toString('base64') });
  }
}
let dropped = 0;
const totalSize = () => engine.length + music.reduce((s, t) => s + t.b64.length + 60, 0);
while (music.length && totalSize() > MAX_PAGE - 400 * 1024) {
  music.sort((a, b2) => a.b64.length - b2.b64.length);
  // 0.mp3 (the title theme) and 1.mp3 are the owner's own tracks and
  // always ship; drop the largest of the rest.
  let k = music.length - 1;
  while (k > 0 && music[k].id <= 1) k -= 1;
  if (music[k].id <= 1) break;
  music.splice(k, 1);
  dropped++;
}
music.sort((a, b2) => a.id - b2.id);
const musicBlob = music.length
  ? `<script>\nwindow.MUSIC_SRC = {\n${music.map((t) =>
      `  ${t.id}: "data:audio/mpeg;base64,${t.b64}"`).join(',\n')}\n};\n</script>\n`
  : '';

// The artifact host wraps published pages in its own <!doctype>/<head>/<body>
// skeleton, so the bundle must be page CONTENT only — title, style, body —
// with no skeleton of its own. index.html keeps the full document for
// local development; the pieces are lifted out of it here.
const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`bundle-sequel: could not find ${label} in index.html`);
  return m[1];
};
const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const style = pick(/<style>([\s\S]*?)<\/style>/, '<style>');
const body = pick(/<body>([\s\S]*?)<script/, '<body> content');

// Template literal pieces, not String.replace: minified engine source will
// contain $' and $& somewhere, and replace treats those as patterns.
const bundle = `<meta charset="utf-8">
<title>${title}</title>
<style>
${style.trim()}
</style>
${body.trim()}
${musicBlob}<script>
${engine.replace(/<\/script>/gi, '<\\/script>')}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024 / 1024).toFixed(2)} MB  ` +
  `(${music.length} tracks inlined${dropped ? `, ${dropped} dropped for size` : ''})`);
