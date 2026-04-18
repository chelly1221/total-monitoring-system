const { execSync } = require('child_process');
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
  execSync(
    `npx prisma db push --schema "${schemaPath}" --skip-generate --accept-data-loss`,
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: dbUrl } }
  );
  console.log('[init-db] Database ready');
} catch (e) {
  console.error('[init-db] Failed:', e.message);
  process.exit(1);
}
