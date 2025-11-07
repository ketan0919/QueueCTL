const { spawnSync } = require('child_process');
const BIN = 'node bin/queuectl.js';

function run(argLine) {
  const args = argLine.trim().split(' ').filter(Boolean);
  console.log('> ' + BIN + ' ' + argLine);
  const res = spawnSync('node', ['bin/queuectl.js', ...args], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status);
}

run('init');
run('config set max_retries 3');
run('config set backoff_base 2');

run(`enqueue '{"id":"ok1","command":"node -e \\"console.log(42)\\""}'`);
run(`enqueue '{"id":"fail1","command":"bash -c \\"exit 2\\""}'`);
run(`enqueue '{"id":"later1","command":"echo scheduled","run_at":"2099-01-01T00:00:00.000Z"}'`);
run('status');

run('worker start --count 2');

setTimeout(() => {
  run('status');
  run('dlq list');
  run('dlq show fail1 || true');
  run('retry fail1 --reset');
  run('status');
  run('worker stop');
}, 4000);
