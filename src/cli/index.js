const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');
const { fork } = require('child_process');

const { db, DB_PATH } = require('../db');
const cfg = require('../config');
const jobs = require('../repo/jobs');

function readJSONMaybe(fileOrJson) {
  if (fileOrJson.startsWith('@')) {
    const file = fileOrJson.slice(1);
    const raw = fs.readFileSync(path.resolve(file), 'utf8');
    return JSON.parse(raw);
  }
  return JSON.parse(fileOrJson);
}

function run() {
  void db;

  program
    .name('queuectl')
    .description('CLI background job queue')
    .version('0.2.0');

  program
    .command('init')
    .description('Initialize the database and default config')
    .action(() => {
      cfg.ensureDefaults();
      console.log(chalk.green('Initialized.'));
      console.log(chalk.dim('DB -> ' + DB_PATH));
      console.log(chalk.dim('Config -> ' + JSON.stringify(cfg.all(), null, 2)));
    });

  program
    .command('enqueue')
    .description('Add a job. Accepts JSON string or @file.json')
    .argument('<payload>', 'e.g. \'{"command":"echo hi"}\' or @job.json')
    .option('--max-retries <n>')
    .option('--priority <n>')
    .option('--timeout <ms>')
    .action((payload, opts) => {
      try {
        const raw = readJSONMaybe(payload);
        if (opts.maxRetries) raw.max_retries = Number(opts.maxRetries);
        if (opts.priority) raw.priority = Number(opts.priority);
        if (opts.timeout) raw.timeout_ms = Number(opts.timeout);
        const job = jobs.enqueue(raw, { max_retries: Number(cfg.get('max_retries')) });
        console.log(chalk.green('enqueued:'), job);
      } catch (e) {
        console.error(chalk.red('Failed to enqueue:'), e.message);
        process.exit(1);
      }
    });

  program
    .command('list')
    .description('List jobs (optionally filter by state)')
    .option('--state <state>', 'pending|processing|completed|failed|dead')
    .option('-n, --limit <n>', 'limit', '50')
    .option('--json', 'output JSON', false)
    .action((opts) => {
      const arr = jobs.list({ state: opts.state, limit: Number(opts.limit) });
      if (opts.json) return console.log(JSON.stringify(arr, null, 2));
      if (arr.length === 0) return console.log(chalk.dim('(no jobs)'));
      arr.forEach(j => {
        console.log(`${j.id}  ${j.state.padEnd(10)} attempts=${j.attempts} max_retries=${j.max_retries}  cmd="${j.command}"`);
      });
    });

  program
    .command('show')
    .description('Show a single job by id')
    .argument('<id>')
    .action((id) => {
      const j = jobs.getById(id);
      if (!j) return console.log(chalk.yellow('job not found'));
      console.log(JSON.stringify(j, null, 2));
    });

  program
    .command('status')
    .description('Show counts by state and running workers')
    .option('--json', 'output as JSON', false)
    .action((opts) => {
      const s = jobs.status();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(s);
    });

  const cfgCmd = program.command('config').description('Read or change defaults');
  cfgCmd.command('get')
    .argument('[key]')
    .action((key) => {
      if (key) return console.log(`${key}=${cfg.get(key)}`);
      console.log(cfg.all());
    });
  cfgCmd.command('set')
    .argument('<key>')
    .argument('<value>')
    .action((key, value) => {
      cfg.set(key, value);
      console.log('ok');
    });

  program
    .command('worker start')
    .description('Start one or more workers')
    .option('--count <n>', 'number of workers', '1')
    .action((opts) => {
      const count = Number(opts.count || 1);
      const workerPath = path.join(__dirname, '..', 'worker', 'process.js');
      for (let i = 0; i < count; i++) {
        const child = fork(workerPath, { stdio: 'inherit', detached: true });
        child.unref();
      }
      console.log(chalk.green(`started ${count} worker(s)`));
    });

  program
    .command('worker stop')
    .description('Stop running workers gracefully')
    .action(() => {
      const rows = db.prepare('SELECT pid FROM workers WHERE status="running"').all();
      rows.forEach(({ pid }) => {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      });
      console.log(chalk.yellow(`sent SIGTERM to ${rows.length} worker(s)`));
    });

  // DLQ + optionals
  const dlq = program.command('dlq').description('Dead Letter Queue');
  dlq.command('list').action(() => {
    const rows = db.prepare('SELECT job_id, reason, failed_at FROM dlq ORDER BY failed_at DESC').all();
    if (rows.length === 0) return console.log(chalk.dim('(DLQ empty)'));
    rows.forEach(r => console.log(`${r.job_id}  ${r.failed_at}  reason="${r.reason || ''}"`));
  });
  dlq.command('show').argument('<jobId>').action((jobId) => {
    const row = db.prepare('SELECT * FROM dlq WHERE job_id = ?').get(jobId);
    if (!row) return console.log(chalk.yellow('not found in DLQ'));
    const payload = (() => { try { return JSON.parse(row.payload_json); } catch { return row.payload_json; } })();
    console.log(JSON.stringify({ job_id: row.job_id, reason: row.reason, failed_at: row.failed_at, payload }, null, 2));
  });
  dlq.command('retry').argument('<jobId>').action((jobId) => {
    const ok = jobs.retryFromDLQ(jobId);
    console.log(ok ? chalk.green(`retried ${jobId}`) : chalk.yellow(`job ${jobId} not found in DLQ`));
  });

  program
    .command('retry')
    .description('Retry a failed/dead job (dead will pull from DLQ if present)')
    .argument('<jobId>')
    .option('--reset', 'reset attempts to 0', false)
    .action((jobId, opts) => {
      const res = jobs.retryJob(jobId, !!opts.reset);
      if (!res.ok) return console.log(chalk.yellow(`retry failed: ${res.reason || 'unknown'}`));
      console.log(chalk.green(`job ${jobId} moved to pending (from ${res.from || 'unknown'})`));
    });

  program
    .command('cancel')
    .description('Cancel a pending/failed job (mark dead)')
    .argument('<jobId>')
    .action((jobId) => {
      const res = jobs.cancelJob(jobId);
      if (!res.ok) return console.log(chalk.yellow(`cannot cancel: ${res.reason || 'unknown'}`));
      console.log(chalk.green('canceled.'));
    });

  program.parse(process.argv);
}

module.exports = { run };
