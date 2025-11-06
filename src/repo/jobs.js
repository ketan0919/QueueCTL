const { db } = require('../db');
const { nanoid } = require('nanoid');

const nowIso = () => new Date().toISOString();

function normalizeJob(input, defaults) {
  if (!input || typeof input !== 'object') throw new Error('Invalid job payload');
  if (!input.command || typeof input.command !== 'string') {
    throw new Error('job.command is required (string)');
  }
  const created_at = nowIso();
  const run_at = input.run_at ? new Date(input.run_at).toISOString() : created_at;

  const job = {
    id: input.id || nanoid(12),
    command: input.command,
    state: 'pending',
    attempts: 0,
    max_retries: Number(
      input.max_retries != null ? input.max_retries : (defaults?.max_retries || 3)
    ),
    run_at,
    retry_at: null,
    priority: Number(input.priority != null ? input.priority : 0),
    last_error: null,
    worker_id: null,
    locked_at: null,
    timeout_ms: input.timeout_ms != null ? Number(input.timeout_ms) : null,
    created_at,
    updated_at: created_at
  };
  return job;
}

function enqueue(raw, defaults) {
  const job = normalizeJob(raw, defaults);
  db.prepare(`
    INSERT INTO jobs
      (id, command, state, attempts, max_retries, run_at, retry_at, priority, last_error, worker_id, locked_at, timeout_ms, created_at, updated_at)
    VALUES
      (@id,@command,@state,@attempts,@max_retries,@run_at,@retry_at,@priority,@last_error,@worker_id,@locked_at,@timeout_ms,@created_at,@updated_at)
  `).run(job);
  return getById(job.id);
}

function getById(id) { return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id); }

function list({ state, limit = 50 } = {}) {
  if (state) {
    return db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC LIMIT ?').all(state, Number(limit));
  }
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(Number(limit));
}

function status() {
  const rows = db.prepare('SELECT state, COUNT(*) as count FROM jobs GROUP BY state').all();
  const map = Object.fromEntries(rows.map(r => [r.state, r.count]));
  return {
    pending: map.pending || 0,
    processing: map.processing || 0,
    completed: map.completed || 0,
    failed: map.failed || 0,
    dead: map.dead || 0
  };
}

module.exports = { enqueue, getById, list, status };
