// Offline reconstruction with Node.js 22.13+; never modifies the source DB.
// Usage: node scripts/compact-history.cjs <source.db> <new.db> [limitMB]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function compact(sourcePath, destinationPath, limitMb = 5120) {
  const sourceFile = path.resolve(sourcePath);
  const destinationFile = path.resolve(destinationPath);
  if (sourceFile.toLowerCase() === destinationFile.toLowerCase() || fs.existsSync(destinationFile)) throw new Error('Destination must be a new, separate file');
  if (!Number.isInteger(limitMb) || limitMb < 1 || limitMb > 10240) throw new Error('Invalid capacity limit');
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const target = new DatabaseSync(destinationFile);
  const iterators = [];
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  const size = () => Number(target.prepare('PRAGMA page_count').get().page_count) * Number(target.prepare('PRAGMA page_size').get().page_size);
  const budget = Math.floor(limitMb * 1024 * 1024 * 0.85);
  try {
    target.exec('PRAGMA auto_vacuum=INCREMENTAL; PRAGMA foreign_keys=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192;');
    const schema = source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all();
    for (const row of schema) target.exec(row.sql);
    target.exec('CREATE INDEX IF NOT EXISTS metric_history_recordedAt_idx ON metric_history(recordedAt)');
    const preserved = {};
    for (const table of schema.filter(row => row.type === 'table' && row.name !== 'metric_history')) {
      const columns = source.prepare('PRAGMA table_info(' + quote(table.name) + ')').all().map(row => row.name);
      const insert = target.prepare(`INSERT INTO ${quote(table.name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      let count = 0;
      target.exec('BEGIN');
      for (const row of source.prepare('SELECT * FROM ' + quote(table.name)).iterate()) {
        insert.run(...columns.map(column => row[column]));
        count++;
      }
      target.exec('COMMIT');
      preserved[table.name] = count;
    }
    if (size() >= budget) throw new Error('Settings and alarms alone exceed the budget; nothing was replaced');
    const now = Date.now();
    const since = now - 365 * 86400000;
    // Merge indexed per-metric streams instead of sorting the entire large DB.
    const historyQuery = 'SELECT id,metricId,value,recordedAt FROM metric_history WHERE metricId=? AND recordedAt>=? AND recordedAt<=? ORDER BY recordedAt DESC';
    const heap = [];
    function push(entry) {
      heap.push(entry);
      let at = heap.length - 1;
      while (at > 0) {
        const parent = Math.floor((at - 1) / 2);
        if (heap[parent].time >= entry.time) break;
        heap[at] = heap[parent];
        at = parent;
      }
      heap[at] = entry;
    }
    function pop() {
      const result = heap[0];
      const last = heap.pop();
      if (heap.length) {
        let at = 0;
        while (at * 2 + 1 < heap.length) {
          let child = at * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].time > heap[child].time) child++;
          if (heap[child].time <= last.time) break;
          heap[at] = heap[child];
          at = child;
        }
        heap[at] = last;
      }
      return result;
    }
    function advance(iterator) {
      const next = iterator.next();
      if (next.done) return;
      const row = next.value;
      const time = typeof row.recordedAt === 'number' ? row.recordedAt : Date.parse(row.recordedAt);
      if (!Number.isFinite(time) || !Number.isFinite(row.value)) throw new Error('Invalid history row');
      push({ row, time, iterator });
    }
    for (const metric of source.prepare('SELECT id FROM metrics').all()) {
      for (const iterator of [source.prepare(historyQuery).iterate(metric.id, since, now), source.prepare(historyQuery).iterate(metric.id, new Date(since).toISOString(), new Date(now).toISOString())]) {
        iterators.push(iterator);
        advance(iterator);
      }
    }
    const insert = target.prepare('INSERT INTO metric_history (id,metricId,value,recordedAt) VALUES (?,?,?,?)');
    const batchLimit = Math.min(5000, Math.max(1, Math.floor(budget / 1024 / 1024) * 100));
    let retained = 0;
    let oldest = null;
    while (heap.length && size() < budget) {
      target.exec('BEGIN');
      for (let batch = 0; batch < batchLimit && heap.length; batch++) {
        const entry = pop();
        insert.run(entry.row.id, entry.row.metricId, entry.row.value, entry.time);
        oldest = entry.time;
        retained++;
        advance(entry.iterator);
      }
      target.exec('COMMIT');
      if (retained % 100000 === 0) console.log(JSON.stringify({ retained, sizeMb: Math.round(size() / 1024 / 1024) }));
    }
    target.prepare("INSERT INTO settings(id,key,value,category,createdAt,updatedAt) VALUES ('history-capacity-limit','historyMaxSizeMb',?,'history',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt").run(String(limitMb), now, now);
    target.prepare("DELETE FROM settings WHERE key='historyCleanupPosition' OR key LIKE 'historyCleanup:%'").run();
    if (size() > limitMb * 1024 * 1024) throw new Error('Rebuilt file exceeded its limit; nothing was replaced');
    if (target.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || target.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Rebuilt database verification failed');
    return { sourceFile, destinationFile, limitMb, bytes: size(), retained, oldest: oldest === null ? null : new Date(oldest).toISOString(), preserved };
  } finally {
    for (const iterator of iterators) iterator.return?.();
    target.close();
    source.close();
  }
}

module.exports = { compact };
if (require.main === module) {
  try {
    const [, , source, destination, limit] = process.argv;
    if (!source || !destination) throw new Error('Provide source and new destination paths');
    console.log(JSON.stringify(compact(source, destination, limit === undefined ? 5120 : Number(limit))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
