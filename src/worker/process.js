const { v4: uuid } = require('uuid');
const { exec } = require('child_process');
const { db } = require('../db');
const cfg = require('../config');

const workerId = uuid();
let stopRequested = false;

const nowIso = () => new Date().toISOString();
const addSecondsIso = (s) => new Date(Date.now() + s * 1000).toISOString();

process.on('SIGTERM', () => {
  stopRequested = true;
  console.log(`[worker ${workerId}] SIGTERM received; stopping after current job.`);
});
process.on('SIGINT', () => {
  stopRequested = true;
});

function registerWorker() {
  db.prepare(`
    INSERT INTO workers(id, pid, status, started_at, heartbeat_at)
    VALUES(?, ?, 'running', ?, ?)
  `).run(workerId, process.pid, nowIso(), nowIso());
  setInterval(() => {
    db.prepare('UPDATE workers SET heartbeat_at=? WHERE id=? AND status="running"').run(nowIso(), workerId);
  }, 2000).unref();
  recoverStaleProcessing();
}

function unregisterWorker() {
  db.prepare(`UPDATE workers SET status='stopped', heartbeat_at=? WHERE id=?`).run(nowIso(), workerId);
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

function reserveNext() {
  const now = nowIso();
  const row = db.prepare(`
    UPDATE jobs
       SET state='processing',
           worker_id=@workerId,
           locked_at=@now,
           updated_at=@now
     WHERE id = (
       SELECT id FROM jobs
        WHERE ((state='pending' AND run_at <= @now) OR (state='failed' AND retry_at <= @now))
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
     )
     RETURNING *
  `).get({ workerId, now });
  return row || null;
}

function complete(jobId) {
  db.prepare(`
    UPDATE jobs
       SET state='completed',
           worker_id=NULL,
           locked_at=NULL,
           updated_at=?
     WHERE id=?
  `).run(nowIso(), jobId);
}

function moveToDLQ(job, reason) {
  const payload = JSON.stringify(job);
  db.prepare(`
    INSERT INTO dlq(id, job_id, failed_at, reason, payload_json)
    VALUES(?, ?, ?, ?, ?)
  `).run(uuid(), job.id, nowIso(), reason || 'max retries reached', payload);
}

function fail(job, errorMessage) {
  const base = Number(cfg.get('backoff_base') || 2);
  const nextAttempts = job.attempts + 1;
  if (nextAttempts > job.max_retries) {
    moveToDLQ(job, errorMessage);
    db.prepare(`
      UPDATE jobs
         SET state='dead',
             attempts=?,
             last_error=?,
             worker_id=NULL,
             locked_at=NULL,
             updated_at=?
       WHERE id=?
    `).run(nextAttempts, String(errorMessage).slice(0, 2000), nowIso(), job.id);
    return { movedToDlq: true };
  } else {
    const delaySeconds = Math.pow(base, nextAttempts);
    const nextRun = addSecondsIso(delaySeconds);
    db.prepare(`
      UPDATE jobs
         SET state='failed',
             attempts=?,
             last_error=?,
             retry_at=?,
             worker_id=NULL,
             locked_at=NULL,
             updated_at=?
       WHERE id=?
    `).run(nextAttempts, String(errorMessage).slice(0, 2000), nextRun, nowIso(), job.id);
    return { movedToDlq: false, nextRun };
  }
}

function runCommand(job) {
  return new Promise((resolve) => {
    exec(job.command, { shell: true, windowsHide: true, timeout: job.timeout_ms || 0 }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, stdout });
      const msg = stderr?.toString() || error.message || 'unknown error';
      resolve({ ok: false, error: msg, code: error.code });
    });
  });
}

async function loop() {
  registerWorker();
  const pollInterval = Number(cfg.get('poll_interval_ms') || 400);

  while (!stopRequested) {
    const job = reserveNext();
    if (!job) {
      await new Promise(r => setTimeout(r, pollInterval));
      continue;
    }
    console.log(`[worker ${workerId}] processing ${job.id} -> "${job.command}"`);
    const result = await runCommand(job);
    if (result.ok) {
      complete(job.id);
      console.log(`[worker ${workerId}] completed ${job.id}`);
    } else {
      const res = fail(job, result.error);
      if (res.movedToDlq) {
        console.log(`[worker ${workerId}] job ${job.id} moved to DLQ (retries exhausted)`);
      } else {
        console.log(`[worker ${workerId}] job ${job.id} failed: ${result.error}. retry at ${res.nextRun}`);
      }
    }
  }

  unregisterWorker();
  console.log(`[worker ${workerId}] stopped gracefully.`);
  process.exit(0);
}

loop();
