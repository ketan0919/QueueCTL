const { db } = require('../db');
const { nanoid } = require('nanoid');
const { v4: uuid } = require('uuid');
const cfg = require('../config');

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
    max_retries: Number(input.max_retries != null ? input.max_retries : (defaults?.max_retries || 3)),
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
  const workers = db.prepare('SELECT COUNT(*) as c FROM workers WHERE status="running"').get();
  return {
    pending: map.pending || 0,
    processing: map.processing || 0,
    completed: map.completed || 0,
    failed: map.failed || 0,
    dead: map.dead || 0,
    workers: workers.c || 0
  };
}

function recoverStaleProcessing() {
  const staleSeconds = Number(cfg.get('stale_lock_seconds') || 60);
  const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
  db.prepare(`
    UPDATE jobs
       SET state='failed',
           last_error='recovered from stale processing',
           worker_id=NULL,
           locked_at=NULL,
           retry_at=?
     WHERE state='processing' AND locked_at < ?
  `).run(nowIso(), cutoff);
}

function moveToDLQ(job, reason) {
  const payload = JSON.stringify(getById(job.id) || job);
  db.prepare(`
    INSERT INTO dlq(id, job_id, failed_at, reason, payload_json)
    VALUES(?, ?, ?, ?, ?)
  `).run(uuid(), job.id, nowIso(), reason || 'max retries reached', payload);
}

function retryFromDLQ(jobId) {
  const dlqRow = db.prepare('SELECT * FROM dlq WHERE job_id=?').get(jobId);
  if (!dlqRow) return false;
  db.prepare(`
    UPDATE jobs SET state='pending', attempts=0, last_error=NULL, retry_at=NULL, worker_id=NULL, locked_at=NULL, updated_at=?
     WHERE id=?
  `).run(nowIso(), jobId);
  db.prepare('DELETE FROM dlq WHERE job_id=?').run(jobId);
  return true;
}

// Optional helpers
function retryJob(jobId, reset) {
  const job = getById(jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.state === 'dead') {
    const ok = retryFromDLQ(jobId);
    if (ok) return { ok: true, from: 'dlq' };
    db.prepare(`
      UPDATE jobs SET state='pending', attempts=?, last_error=NULL, retry_at=NULL, worker_id=NULL, locked_at=NULL, updated_at=?
       WHERE id=?
    `).run(reset ? 0 : job.attempts, nowIso(), jobId);
    return { ok: true, from: 'dead' };
  }
  if (job.state === 'completed') return { ok: false, reason: 'completed' };
  db.prepare(`
    UPDATE jobs SET state='pending', ${reset ? 'attempts=0,' : ''} retry_at=NULL, worker_id=NULL, locked_at=NULL, updated_at=?
     WHERE id=?
  `).run(nowIso(), jobId);
  return { ok: true, from: job.state };
}

function cancelJob(jobId) {
  const job = getById(jobId);
  if (!job) return { ok: false, reason: 'not_found' };
  if (job.state === 'processing') return { ok: false, reason: 'processing' };
  db.prepare(`
    UPDATE jobs SET state='dead', last_error='canceled', worker_id=NULL, locked_at=NULL, updated_at=?
     WHERE id=? AND state IN ('pending','failed')
  `).run(nowIso(), jobId);
  return { ok: true };
}

module.exports = {
  enqueue, getById, list, status,
  recoverStaleProcessing, moveToDLQ, retryFromDLQ,
  retryJob, cancelJob
};
