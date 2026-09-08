const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const schemaPath = process.argv[2];
if (!schemaPath) {
  console.error('Usage: node init-db.js <schema-path>');
  process.exit(1);
}

console.log('[init-db] DATABASE_URL:', dbUrl);
console.log('[init-db] Schema:', schemaPath);

try {
  // Prisma 5's Windows schema engine can fail to create a missing SQLite file.
  // Opening in append mode creates it without truncating an existing database.
  if (dbUrl.startsWith('file:')) {
    const filename = dbUrl.slice(5).split('?')[0];
    const dbPath = path.resolve(path.dirname(schemaPath), filename);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.closeSync(fs.openSync(dbPath, 'a'));
  }
  execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'db', 'push', '--schema', schemaPath, '--skip-generate'],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: dbUrl } }
  );
  console.log('[init-db] Database ready');
} catch (e) {
  console.error('[init-db] Failed:', e.message);
  process.exit(1);
}
