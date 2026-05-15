# TeamAssistant C++ Backend

This is the Drogon + SQLite WAL backend for API v2.

## Build

```powershell
npm run backend:configure
npm run backend:build
npm run backend:serve
```

The executable listens on `PORT` or `23219`.

## Design Notes

- SQLite is configured with WAL, `busy_timeout`, and foreign keys.
- Slot lock acquisition touches only `slot_locks`.
- Slot member saves are intended to run in one short transaction: validate lock, update one slot, append one operation log, release the lock, increment versions.
- The implementation intentionally avoids a process-wide mutation queue.

The initial scaffold exposes health/version/bootstrap/sync/SSE and lock endpoints, plus placeholders for write endpoints. See `docs/api-v2.md` for the complete contract.
