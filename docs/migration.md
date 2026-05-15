# TeamAssistant Frontend/C++ Backend Migration

## Directory Migration

- Move the React/Vite app into `frontend/`.
- Move the current Node backend into `legacy-node/` as the reference implementation.
- Add the new Drogon/SQLite backend under `backend-cpp/`.

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

## Concurrency Model

- SQLite runs in WAL mode with `busy_timeout` and short write transactions.
- Slot lock writes touch only the lock table.
- Slot saves validate the lock token, update one slot, append one log, release the lock, and increment versions in one transaction.
- The service must not use a global application queue for unrelated teams or slots.

## Acceptance Criteria

- 30 concurrent saves to different team/slot pairs complete successfully.
- 30 concurrent lock attempts against one slot produce one winner and fast conflict responses.
- Successful member saves release the corresponding slot lock.
- SSE/version/sync notify other clients without requiring full snapshot writes.
- Backup import accepts the current `.json.gz` format.
