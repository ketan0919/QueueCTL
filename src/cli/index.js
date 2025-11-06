const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');

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
    .version('0.1.0');

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
    .option('--max-retries <n>', 'override max_retries')
    .option('--priority <n>', 'priority (0=default)')
    .option('--timeout <ms>', 'timeout in milliseconds')
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
    .description('Show counts by state')
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

  program.parse(process.argv);
}

module.exports = { run };
