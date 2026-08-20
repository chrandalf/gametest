#!/usr/bin/env node
// Inlines the sequel tech demo into one self-contained page:
//   node tools/bundle-sequel.js   ->  dist/neon-drive-2.html
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'neon-drive-2.html');
const html = fs.readFileSync(path.join(root, 'sequel', 'index.html'), 'utf8');
const babylon = fs.readFileSync(path.join(root, 'sequel', 'vendor', 'babylon.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'sequel', 'main.js'), 'utf8');

const esc = (s) => s.replace(/<\/script>/gi, '<\\/script>');
// Replacement callbacks, not strings: 8 MB of engine source is guaranteed to
// contain $' and $& somewhere, and String.replace treats those as patterns.
const bundle = html
  .replace('<script src="vendor/babylon.js"></script>',
           () => `<script>\n${esc(babylon)}\n</script>`)
  .replace('<script src="main.js"></script>',
           () => `<script>\n${esc(main)}\n</script>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`${path.relative(root, out)}  ${(bundle.length / 1024 / 1024).toFixed(2)} MB`);
