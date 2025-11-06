# queuectl

Original CLI background job queue — hand-written (no templates).

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

Optionals (included)
- Scheduled jobs via run_at
- dlq show <jobId> to inspect payload
- retry <jobId> [--reset] (failed/dead)
- cancel <jobId> (pending/failed)

## Dev usage (no global link)
- node bin/queuectl.js init
- node bin/queuectl.js enqueue '{"command":"echo Hello"}'
- node bin/queuectl.js list
- node bin/queuectl.js status
- node bin/queuectl.js worker start --count 2
- node bin/queuectl.js dlq list
- node bin/queuectl.js worker stop

(Optional) npm link => use `queuectl` directly.
