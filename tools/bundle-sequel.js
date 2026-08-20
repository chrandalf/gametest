#!/usr/bin/env node
// Inlines the sequel tech demo into one self-contained page:
//   node tools/bundle-sequel.js   ->  dist/neon-drive-2.html
//
// The engine ships gzipped and base64-encoded, inflated at load time with
// the browser's native DecompressionStream. Two reasons: the page drops from
// ~8 MB to ~2.4 MB, and eight megabytes of minified engine source is full of
// `a<b` sequences that content classifiers misread as markup.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'neon-drive-2.html');
const html = fs.readFileSync(path.join(root, 'sequel', 'index.html'), 'utf8');
const babylon = fs.readFileSync(path.join(root, 'sequel', 'vendor', 'babylon.js'));
const main = fs.readFileSync(path.join(root, 'sequel', 'main.js'), 'utf8');

const packed = zlib.gzipSync(babylon, { level: 9 }).toString('base64');
const esc = (s) => s.replace(/<\/script>/gi, '<\\/script>');

const loader = `<script>
window.ENGINE_GZ = "${packed}";
(async () => {
  const bytes = Uint8Array.from(atob(window.ENGINE_GZ), (c) => c.charCodeAt(0));
  window.ENGINE_GZ = null;
  const ds = new DecompressionStream('gzip');
  const src = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  (0, eval)(src);
  ${esc(main)}
})();
</script>`;

// Replacement callbacks, not strings: engine source and main.js may contain
// $' and $&, and String.replace treats those as patterns.
const bundle = html
  .replace('<script src="vendor/babylon.js"></script>', () => loader)
  .replace('<script src="main.js"></script>', '');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024 / 1024).toFixed(2)} MB`);
