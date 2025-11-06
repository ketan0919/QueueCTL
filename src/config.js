const { db } = require('./db');

const DEFAULTS = Object.freeze({
  max_retries: '3',
  backoff_base: '2',
  poll_interval_ms: '400',
  stale_lock_seconds: '60'
});

function ensureDefaults() {
  const stmt = db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULTS)) stmt.run(k, v);
}

function get(key) {
  const row = db.prepare('SELECT value FROM config WHERE key=?').get(key);
  return row ? row.value : DEFAULTS[key];
}

function set(key, value) {
  db.prepare(`
    INSERT INTO config(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));
}

function all() {
  const rows = db.prepare('SELECT key,value FROM config').all();
  const out = { ...DEFAULTS };
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

module.exports = { ensureDefaults, get, set, all, DEFAULTS };
