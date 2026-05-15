# TeamAssistant API v2

This document defines the contract used by the split React frontend and the new C++ backend.

## Goals

- Keep slot signup saves atomic: a save validates the slot lock, updates one slot, writes the log, increments versions, and releases the slot lock in one transaction.
- Avoid returning the full snapshot for routine writes. Writes return versions and a patch.
- Allow users to work concurrently across different teams and slots without a global application queue.

## Common Response Fields

- `ok`: boolean success flag.
- `error`: human-readable error for unexpected failures.
- `reason`: stable conflict code for expected failures, such as `teamLocked`, `expired`, or `slotChanged`.
- `dataVersion`: monotonically increasing data version.
- `lockVersion`: monotonically increasing process-local lock version. Lock state is intentionally memory-only and resets when the backend restarts.

## Sync Endpoints

- `GET /api/v2/version`
  - Returns `{ ok, dataVersion, lockVersion }`.
- `GET /api/v2/bootstrap?qq=...`
  - Returns the initial public snapshot: teams, cancellations, archivedTeams, logs, userProfiles, subsidyPresets, current memory locks, teamLocks, versions, and viewer admin status.
  - `cancellations` and `logs` are capped to a recent window (200 and 500 entries by default). The response includes `cancellationsTotal`, `cancellationsTruncated`, `logsTotal`, and `logsTruncated` flags so the client can decide whether to fetch older entries from the dedicated history endpoints below.
- `GET /api/v2/logs?teamId=&before=&limit=`
  - Returns operation logs ordered by `timestamp DESC`. `teamId` filters to a single team, `before` (timestamp in ms) pages older entries, and `limit` is bounded server-side (default 200, max 500). The response is `{ ok, items, hasMore, nextCursor, limit }` where `nextCursor` is the timestamp of the last returned entry; pass it back as `before` to load the next older page.
- `GET /api/v2/cancellations?qq=&before=&limit=`
  - Same shape as `/api/v2/logs`. `qq` filters by member when provided.

- `GET /api/v2/sync?dataVersion=&lockVersion=`
  - Returns changed data and/or locks only when the caller versions are stale.
  - When the caller is only behind by recent slot save operations, the response may include `patches` instead of a full `data` snapshot. Clients must apply patches in order and fall back to `data` whenever it is present.
- `GET /api/v2/events`
  - Persistent server-sent events. Sends `hello` once, then `version` events with `{ ok, type, dataVersion, lockVersion }`.
  - Browsers that support `EventSource` should use this as the primary sync trigger. The frontend still keeps a lightweight `/version` poll as a fallback, so delayed or buffered event streams can recover without a full page refresh.

## Slot Lock And Save

- `POST /api/v2/slot-locks`
  - Body: `{ teamId, slotIndex, qq }`.
  - Returns `{ ok: true, lockToken, timestamp }` or a conflict payload. `lockToken` is an opaque string; clients must not treat it as a timestamp.
- `DELETE /api/v2/slot-locks/{teamId}/{slotIndex}`
  - Body: `{ qq, lockToken }`.
  - Best-effort release, returns `{ ok: true }`.
- `POST /api/v2/slot-locks/validate`
  - Body: `{ teamId, slotIndex, qq, lockToken }`.
  - Optional compatibility endpoint. The frontend should not call it before normal saves.
- `PUT /api/v2/teams/{teamId}/slots/{slotIndex}/member`
  - Body: `{ qq, actorQq, member, lockToken, expectedMemberQq }`.
  - Validates the memory lock and expected member, then uses one short database transaction to update the slot, append an operation log, increment `dataVersion`, release the memory lock, increment `lockVersion`, broadcast SSE, and return `{ ok, dataVersion, lockVersion, patch }`.
- `DELETE /api/v2/teams/{teamId}/slots/{slotIndex}/member`
  - Body: `{ actorQq, lockToken, expectedMemberQq }`.
- `POST /api/v2/teams/{teamId}/slots/{slotIndex}/cancel`
  - Body: `{ reason, cancelledBy, actorQq, lockToken, expectedMemberQq }`.

## Team And Admin Endpoints

- `POST /api/v2/teams`
- `PATCH /api/v2/teams/{teamId}`
- `DELETE /api/v2/teams/{teamId}`
- `POST /api/v2/teams/reorder`
- `POST /api/v2/teams/{teamId}/archive`
- `POST /api/v2/archives/{archiveId}/restore`
- `PATCH /api/v2/teams/{teamId}/lock-state`

All admin operations must be validated on the backend using `actorQq`.

## Subsidy And Backup Endpoints

- `GET /api/v2/subsidy-presets`
- `PUT /api/v2/subsidy-presets`
- `PUT /api/v2/teams/{teamId}/subsidies/{qq}`
- `PUT /api/v2/archives/{archiveId}/subsidies/{qq}`
- `GET /api/v2/backups?actorQq=...`
- `POST /api/v2/backups` with `{ actorQq }`
- `GET /api/v2/backups/{name}/download?actorQq=...`
- `POST /api/v2/backups/{name}/restore` with `{ actorQq }`
- `DELETE /api/v2/backups/{name}` with `{ actorQq }`
- `POST /api/v2/backups/import?actorQq=...`

Backup import and restore may return a full snapshot because the full application state changes.

## Admin Config

- Backend reads administrator QQs from `backend-cpp/admin.json` by default, or `TEAMASSISTANT_ADMIN_CONFIG` when set.
- The admin list is not served to the frontend; `bootstrap` and `sync` return only the current viewer's `isAdmin` boolean.
