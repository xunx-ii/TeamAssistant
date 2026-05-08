import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { applyMutation, normalizeData, validateExpectedSlotMember, validateSlotMutationLock } from './server/data-store.js'
import {
  acquireSlotLock,
  buildSlotLockMap,
  buildTeamLockMap,
  cleanExpiredLocks,
  getPublicLocks,
  getTeamLockTimestamp,
  normalizeLockData,
  removeLocksForTeam,
  releaseSlotLock,
  removeTeamLock,
  setTeamLock,
} from './server/lock-store.js'
import { withFileLock } from './server/shared-file-lock.js'
import { createLevelStore } from './server/level-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 23219
const DATA_FILE = join(__dirname, 'data.json')
const LOCKS_FILE = join(__dirname, 'locks.json')
const LEVEL_DB_DIR = join(__dirname, 'leveldb')
const BACKUP_DIR = join(__dirname, 'backup')
const STORAGE_LOCK_FILE = join(__dirname, '.storage.lock')
const LOCK_TIMEOUT = 30_000
const BACKUP_INTERVAL_MS = 30 * 60 * 1000
const BACKUP_HISTORY_LIMIT = 48
const STORAGE_LOCK_STALE_MS = 15_000
const STORAGE_LOCK_TIMEOUT_MS = 10_000
const LOCK_LOG = process.env.DEBUG === '1'

const store = createLevelStore({
  dbPath: LEVEL_DB_DIR,
  legacyDataFile: DATA_FILE,
  legacyLocksFile: LOCKS_FILE,
  backupDir: BACKUP_DIR,
  maxBackups: BACKUP_HISTORY_LIMIT,
  normalizeData,
  normalizeLocks: normalizeLockData,
})

async function withSharedStorage(callback) {
  return withFileLock(STORAGE_LOCK_FILE, callback, {
    staleMs: STORAGE_LOCK_STALE_MS,
    timeoutMs: STORAGE_LOCK_TIMEOUT_MS,
  })
}

async function loadLocks() {
  const cleaned = cleanExpiredLocks(await store.readLocks(), LOCK_TIMEOUT)
  if (cleaned.changed) {
    await store.writeLocks(cleaned.lockData)
  }
  return cleaned.lockData
}

async function loadData() {
  return normalizeData(await store.readData())
}

async function saveData(data) {
  await store.writeData(normalizeData(data))
}

function scheduleBackups() {
  const interval = setInterval(() => {
    void withSharedStorage(() => store.backupNow())
      .catch(error => {
        console.error('[backup] failed:', error instanceof Error ? error.message : error)
      })
  }, BACKUP_INTERVAL_MS)
  interval.unref?.()
  return interval
}

app.use(express.json({ limit: '10mb' }))

// API router - mounted before static, ensures API routes take priority
const api = express.Router()

api.get('/data', async (_req, res) => {
  try {
    const data = await withSharedStorage(async () => {
      const current = await loadData()
      current.locks = getPublicLocks(await loadLocks()).slots
      return current
    })
    res.json(data)
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load failed' })
  }
})

api.post('/data', async (req, res) => {
  try {
    await withSharedStorage(() => saveData(req.body))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Save failed' })
  }
})

api.post('/mutate', async (req, res) => {
  const { mutation } = req.body ?? {}
  if (!mutation?.type) {
    return res.status(400).json({ ok: false, error: 'Missing mutation' })
  }

  try {
    const data = await withSharedStorage(async () => {
      let lockState = await loadLocks()
      if (mutation.type === 'signupSlot' || mutation.type === 'leaveSlot' || mutation.type === 'cancelSlot') {
        const lockResult = validateSlotMutationLock({
          slotLocks: buildSlotLockMap(lockState),
          teamLocks: buildTeamLockMap(lockState),
          teamId: mutation.teamId,
          slotIndex: mutation.slotIndex,
          qq: mutation.actorQq ?? mutation.member?.qq ?? mutation.cancelledBy,
          lockTimestamp: mutation.lockTimestamp,
          lockTimeout: LOCK_TIMEOUT,
        })
        if (!lockResult.ok) {
          const error = new Error(lockResult.reason)
          error.details = lockResult
          throw error
        }
      }

      const current = await loadData()
      if (mutation.type === 'setTeamLockState') {
        const updatedLockState = mutation.locked
          ? setTeamLock(lockState, {
              teamId: mutation.teamId,
              timestamp: getTeamLockTimestamp(lockState, mutation.teamId) ?? Date.now(),
            })
          : removeTeamLock(lockState, { teamId: mutation.teamId })
        lockState = updatedLockState.lockData
        await store.writeLocks(lockState)
      }
      if (mutation.type === 'archiveTeam') {
        const updatedLockState = removeLocksForTeam(lockState, { teamId: mutation.teamId })
        if (updatedLockState.changed) {
          lockState = updatedLockState.lockData
          await store.writeLocks(lockState)
        }
      }
      if (
        (mutation.type === 'signupSlot' || mutation.type === 'leaveSlot' || mutation.type === 'cancelSlot') &&
        Object.prototype.hasOwnProperty.call(mutation, 'expectedMemberQq')
      ) {
        const expected = validateExpectedSlotMember(current, mutation.teamId, mutation.slotIndex, mutation.expectedMemberQq)
        if (!expected.ok) {
          const error = new Error(expected.reason)
          error.details = expected
          throw error
        }
      }

      const next = normalizeData(applyMutation(current, mutation))
      await store.writeData(next)
      return next
    })
    res.json({ ok: true, data })
  } catch (error) {
    const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined
    const message = error instanceof Error ? error.message : 'Mutation failed'
    if (details?.reason === 'teamLocked' || details?.reason === 'expired' || details?.reason === 'slotChanged') {
      return res.status(409).json({ ok: false, ...details })
    }
    res.status(400).json({ ok: false, error: message })
  }
})

// Dedicated locks endpoint (responds within 1s polling)
api.get('/locks', async (_req, res) => {
  try {
    const locks = await withSharedStorage(async () => getPublicLocks(await loadLocks()))
    if (LOCK_LOG) console.log(`[lock] GET /locks → ${locks.slots.length} slots, ${locks.teams.length} teams`)
    res.json(locks)
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load failed' })
  }
})

api.post('/lock', async (req, res) => {
  const { teamId, slotIndex, qq } = req.body
  if (!teamId || slotIndex == null || !qq) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }

  try {
    const result = await withSharedStorage(async () => {
      const current = await loadLocks()
      const updated = acquireSlotLock(current, {
        teamId,
        slotIndex,
        qq,
        lockTimeout: LOCK_TIMEOUT,
      })
      if (updated.changed) {
        await store.writeLocks(updated.lockData)
      }
      return updated.result
    })
    if (!result.ok && result.lockedBy && LOCK_LOG) {
      console.log(`[lock] CONFLICT: ${teamId}:${slotIndex} locked by ${result.lockedBy} at ${result.lockedAt}`)
    }
    if (result.ok && LOCK_LOG) {
      console.log(`[lock] ACQUIRED: ${teamId}:${slotIndex} by ${qq} at ${result.timestamp}`)
    }
    res.json(result)
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Acquire failed' })
  }
})

api.delete('/lock', async (req, res) => {
  const { teamId, slotIndex, qq, lockTimestamp } = req.body
  if (LOCK_LOG) console.log(`[lock] RELEASE: ${teamId}:${slotIndex} by ${qq}`)
  if (!teamId || slotIndex == null) {
    return res.status(400).json({ ok: false })
  }

  try {
    await withSharedStorage(async () => {
      const current = await loadLocks()
      const updated = releaseSlotLock(current, { teamId, slotIndex, qq, lockTimestamp })
      if (updated.changed) {
        await store.writeLocks(updated.lockData)
        if (LOCK_LOG) console.log(`[lock] RELEASED: ${teamId}:${slotIndex}`)
      }
    })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Release failed' })
  }
})

// Team-level lock API (stores timestamp for conflict resolution)
api.post('/team-lock', async (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  try {
    const result = await withSharedStorage(async () => {
      const updated = setTeamLock(await loadLocks(), { teamId })
      await store.writeLocks(updated.lockData)
      return updated
    })
    if (LOCK_LOG) console.log(`[lock] TEAM LOCKED: ${teamId} at ${result.timestamp}`)
    res.json({ ok: true, timestamp: result.timestamp })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Team lock failed' })
  }
})

api.delete('/team-lock', async (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  try {
    await withSharedStorage(async () => {
      const updated = removeTeamLock(await loadLocks(), { teamId })
      if (updated.changed) {
        await store.writeLocks(updated.lockData)
      }
    })
    if (LOCK_LOG) console.log(`[lock] TEAM UNLOCKED: ${teamId}`)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Team unlock failed' })
  }
})

// Validate lock before save (checks team locks and slot locks by timestamp)
api.post('/validate-lock', async (req, res) => {
  const { teamId, slotIndex, qq, lockTimestamp } = req.body
  if (!teamId || slotIndex == null || !qq || !lockTimestamp) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }

  try {
    const result = await withSharedStorage(async () => {
      const lockState = await loadLocks()
      return validateSlotMutationLock({
        slotLocks: buildSlotLockMap(lockState),
        teamLocks: buildTeamLockMap(lockState),
        teamId,
        slotIndex,
        qq,
        lockTimestamp,
        lockTimeout: LOCK_TIMEOUT,
      })
    })
    if (result.ok) {
      return res.json({ ok: true })
    }
    if (result.reason === 'teamLocked') {
      return res.json({ ok: false, reason: 'teamLocked', lockedAt: result.lockedAt })
    }
    return res.json({ ok: false, reason: 'expired' })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Validate failed' })
  }
})

// Mount API router before static
app.use('/api', api)

// Static files
app.use(express.static(join(__dirname, 'dist')))

// SPA fallback
app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

await store.init()
scheduleBackups()

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  if (LOCK_LOG) console.log('[lock] debug logging enabled')
})

async function shutdown() {
  server.close()
  await store.close()
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
