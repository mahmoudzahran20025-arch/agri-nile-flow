# Verify the outbox worker cron is wired in wrangler.toml / src/index.ts
- Read src/index.ts scheduled() handler. Confirm it calls processAllPendingOutbox().
- Read wrangler.toml — confirm [triggers] crons includes a schedule (e.g. "*/5 * * * *").
- If cron is missing: add it. If scheduled() doesn't call outbox: add the call.
Verification:
- `grep -n "processAllPendingOutbox\|scheduled" src/index.ts` shows the call. wrangler.toml has crons entry.
