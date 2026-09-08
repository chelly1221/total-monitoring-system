/**
 * Build script: prepares Next.js standalone + worker for Tauri bundling.
 *
 * 1. Runs `next build` (output: 'standalone')
 * 2. Copies standalone server, static, public into src-tauri/resources/
 * 3. Compiles worker with esbuild into src-tauri/resources/worker/
 * 4. Copies prisma schema + migrations
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'src-tauri', 'resources');

function rm(dir) {
  const relative = path.relative(ROOT, path.resolve(dir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside the project: ${dir}`);
  }
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

function cp(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    // Ship real files, not links back to the development machine's modules.
    dereference: true,
    // Runtime data and local environment files never belong in an installer.
    filter: (entry) => !/\.db(?:-.*)?$|^\.env(?:\..*)?$/.test(path.basename(entry)),
  });
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// Clean
rm(RESOURCES);
fs.mkdirSync(RESOURCES, { recursive: true });

// 1. Next.js standalone build
run('npx next build');

// 2. Copy standalone output
const standalone = path.join(ROOT, '.next', 'standalone');
const standaloneDest = path.join(RESOURCES, 'standalone');
fs.mkdirSync(standaloneDest, { recursive: true });
// Only the Next.js runtime is needed; tracing can also discover project files
// through dynamic filesystem paths used by uploads.
for (const entry of ['.next', 'node_modules', 'package.json', 'server.js']) {
  cp(path.join(standalone, entry), path.join(standaloneDest, entry));
}

// Copy static assets into standalone
const staticSrc = path.join(ROOT, '.next', 'static');
const staticDest = path.join(RESOURCES, 'standalone', '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.mkdirSync(staticDest, { recursive: true });
  cp(staticSrc, staticDest);
}

// Copy public folder
const publicSrc = path.join(ROOT, 'public');
const publicDest = path.join(RESOURCES, 'standalone', 'public');
if (fs.existsSync(publicSrc)) {
  fs.mkdirSync(publicDest, { recursive: true });
  cp(publicSrc, publicDest);
}

// 3. Bundle worker with esbuild
const workerDir = path.join(RESOURCES, 'worker');
fs.mkdirSync(workerDir, { recursive: true });
run(`npx esbuild src/worker/index.ts --bundle --platform=node --target=node20 --outfile=src-tauri/resources/worker/index.js --external:@prisma/client --external:prisma`);

// 4. Copy prisma
fs.mkdirSync(path.join(RESOURCES, 'prisma'), { recursive: true });
cp(path.join(ROOT, 'prisma', 'schema.prisma'), path.join(RESOURCES, 'prisma', 'schema.prisma'));
cp(path.join(ROOT, 'prisma', 'migrations'), path.join(RESOURCES, 'prisma', 'migrations'));

// Copy node_modules/.prisma (generated client)
const prismaClient = path.join(ROOT, 'node_modules', '.prisma');
if (fs.existsSync(prismaClient)) {
  cp(prismaClient, path.join(RESOURCES, 'node_modules', '.prisma'));
}
const prismaNodeModule = path.join(ROOT, 'node_modules', '@prisma');
if (fs.existsSync(prismaNodeModule)) {
  cp(prismaNodeModule, path.join(RESOURCES, 'node_modules', '@prisma'));
}

// Copy prisma CLI (needed for runtime db push)
const prismaCli = path.join(ROOT, 'node_modules', 'prisma');
if (fs.existsSync(prismaCli)) {
  cp(prismaCli, path.join(RESOURCES, 'node_modules', 'prisma'));
}

// Copy .bin/prisma for npx
const binDir = path.join(ROOT, 'node_modules', '.bin');
const resBinDir = path.join(RESOURCES, 'node_modules', '.bin');
fs.mkdirSync(resBinDir, { recursive: true });
for (const name of ['prisma', 'prisma.cmd', 'prisma.ps1']) {
  const src = path.join(binDir, name);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(resBinDir, name));
  }
}

// Copy init-db script
fs.cpSync(path.join(ROOT, 'scripts', 'init-db.js'), path.join(RESOURCES, 'init-db.js'));

console.log('\n✅ Build complete. Resources ready in src-tauri/resources/');
