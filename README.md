# queuectl

Original CLI background job queue — no templates, hand-written.

## Features
Part 1
- SQLite (WAL), schema bootstrap
- Config store (max_retries, backoff_base, poll_interval_ms, stale_lock_seconds)
- Commands: init, enqueue, list, show, status, config get/set

Part 2
- Worker process (multiple) with graceful shutdown
- Atomic job reservation (single UPDATE ... RETURNING)
- Exponential backoff retries (delay = base^attempts)
- Dead Letter Queue (DLQ) with dlq list/retry
- Stale processing recovery

Optionals
- Scheduled jobs via run_at in enqueue payload
- dlq show <jobId> to inspect payload
- retry <jobId> [--reset] for failed/dead
- cancel <jobId> for pending/failed

## Install
- npm install

## Dev usage (no global link)
- node bin/queuectl.js init
- node bin/queuectl.js enqueue '{"command":"echo Hello"}'
- node bin/queuectl.js list
- node bin/queuectl.js status
- node bin/queuectl.js worker start --count 2
- node bin/queuectl.js dlq list
- node bin/queuectl.js worker stop

(Optional) npm link => use `queuectl` directly.

## Job payload (example)
{
  "command": "echo 'Hello World'",
  "max_retries": 3,
  "priority": 0,
  "timeout_ms": 0,
  "run_at": "2025-12-31T23:59:59.000Z"
}

## Notes
- Jobs exceeding max_retries move to DLQ (state=dead). Use dlq retry <id> or retry <id> to requeue.
- Stale "processing" jobs (older than stale_lock_seconds) are auto-recovered to failed with immediate retry.
- UPDATE ... RETURNING ensures only one worker claims a job.

## Scenario script
- npm run test:scenarios
