# TeamAssistant Frontend/C++ Backend Migration

## Directory Migration

- Move the React/Vite app into `frontend/`.
- Add the new Drogon/SQLite backend under `backend-cpp/`.
- Remove the old Node backend after the C++ API covers the required runtime and backup compatibility paths.

## Data Migration

The C++ backend imports the existing backup format instead of reading the old LevelDB directly.

Supported backup payload:

```json
{
  "version": 1,
  "createdAt": "2026-01-01T00:00:00.000+08:00",
  "data": {
    "teams": [],
    "cancellations": [],
    "archivedTeams": [],
    "logs": [],
    "userProfiles": {}
  },
  "locks": {
    "slots": [],
    "teams": []
  },
  "subsidyPresets": []
}
```

The `locks` field remains accepted for backup compatibility, but runtime locks are not restored into SQLite. Slot locks and team runtime locks are process-local and are rebuilt by active clients after restart.

## Concurrency Model

- SQLite runs in WAL mode with `synchronous=NORMAL`, `busy_timeout`, memory temp storage, a larger page cache, and short write transactions.
- Slot locks and team runtime locks live in memory, not SQLite. Lock acquire/release does not open a database transaction.
- Slot saves validate the memory lock token, update one slot, append one log, release the memory lock, and increment versions with only the slot/log write inside SQLite.
- The service must not use a global application queue for unrelated teams or slots.

## Acceptance Criteria

- 30 concurrent saves to different team/slot pairs complete successfully.
- 30 concurrent lock attempts against one slot produce one winner and fast conflict responses.
- Successful member saves release the corresponding slot lock.
- SSE/version/sync notify other clients without requiring full snapshot writes.
- Backup import accepts the current `.json.gz` format.
