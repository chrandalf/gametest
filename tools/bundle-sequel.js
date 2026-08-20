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
<script>
${engine.replace(/<\/script>/gi, '<\\/script>')}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024 / 1024).toFixed(2)} MB`);
