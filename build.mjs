// Build: bundle + minify src/main.js (tree-shaken three.js) and copy public/ -> dist/
//  - app.js gets a content hash in its name -> can be cached "forever" by the browser
//  - every text/binary asset gets a pre-compressed .gz twin for nginx gzip_static
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, statSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, constants } from 'node:zlib';
import { basename } from 'node:path';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });

const result = await build({
  entryPoints: { app: 'src/main.js' },
  outdir: 'dist',
  entryNames: '[name]-[hash]',
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome100', 'safari15'],
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const appFile = basename(Object.keys(result.metafile.outputs).find(f => f.endsWith('.js')));
const html = readFileSync('dist/index.html', 'utf8');
if (!html.includes('"app.js"')) throw new Error('index.html must reference "app.js"');
writeFileSync('dist/index.html', html.replaceAll('"app.js"', `"${appFile}"`));

for (const f of readdirSync('dist')) {
  if (!/\.(js|html|glb|txt)$/.test(f)) continue;
  const buf = readFileSync(`dist/${f}`);
  const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION });
  writeFileSync(`dist/${f}.gz`, gz);
  console.log(`${f.padEnd(26)} ${(buf.length / 1024).toFixed(1).padStart(8)} KB   gzip ${(gz.length / 1024).toFixed(1).padStart(7)} KB`);
}
