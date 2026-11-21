import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STATIC_PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-512.png',
];

function collectDistFiles(dirPath, rootDir = dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDistFiles(fullPath, rootDir));
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (rel !== 'sw.js' && !rel.endsWith('.map')) {
        results.push(rel);
      }
    }
  }
  return results;
}

function offlineSwPrecachePlugin() {
  let outDir = path.resolve(process.cwd(), 'dist');

  return {
    name: 'offline-sw-precache',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res, next) => {
        try {
          const swPath = path.resolve(process.cwd(), 'src/sw.js');
          const template = fs.readFileSync(swPath, 'utf-8');
          const source = template
            .replace("'__SW_CACHE_NAME__'", JSON.stringify('pte-trainer-dev'))
            .replace('__SW_PRECACHE_URLS__', JSON.stringify(STATIC_PRECACHE, null, 2));
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(source);
        } catch (err) {
          next(err);
        }
      });
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      const diskFiles = collectDistFiles(outDir).sort();
      const precacheUrls = Array.from(
        new Set(['./', ...diskFiles.map((rel) => `./${rel}`)])
      ).sort();

      const swPath = path.resolve(process.cwd(), 'src/sw.js');
      const template = fs.readFileSync(swPath, 'utf-8');

      const hasher = crypto.createHash('sha256');
      hasher.update(JSON.stringify(precacheUrls));
      hasher.update(template);
      for (const rel of diskFiles) {
        hasher.update(fs.readFileSync(path.join(outDir, rel)));
      }
      const hash = hasher.digest('hex').slice(0, 8);
      const cacheName = `pte-trainer-v15-${hash}`;

      const source = template
        .replace("'__SW_CACHE_NAME__'", JSON.stringify(cacheName))
        .replace('__SW_PRECACHE_URLS__', JSON.stringify(precacheUrls, null, 2));
      fs.writeFileSync(path.join(outDir, 'sw.js'), source, 'utf-8');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineSwPrecachePlugin()],
});
