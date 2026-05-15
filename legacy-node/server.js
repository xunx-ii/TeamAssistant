import express from 'express'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  normalizeHydratableData,
  normalizeData,
  validateSnapshotData,
} from './server/data-store.js'
import {
  normalizeLockData,
} from './server/lock-store.js'
import { withFileLock } from './server/shared-file-lock.js'
import { createLevelStore } from './server/level-store.js'
import { createRuntimeState } from './server/runtime-state.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 23219
const DATA_FILE = join(__dirname, 'data.json')
const LOCKS_FILE = join(__dirname, 'locks.json')
const ADMIN_FILE = join(__dirname, 'admin.json')
const STATIC_DIR = join(__dirname, '..', 'frontend', 'dist')
const LEVEL_DB_DIR = join(__dirname, 'leveldb')
const BACKUP_DIR = join(__dirname, 'backup')
const STORAGE_LOCK_FILE = join(__dirname, '.storage.lock')
const LOCK_TIMEOUT = 30_000
const BACKUP_INTERVAL_MS = 30 * 60 * 1000
const BACKUP_HISTORY_LIMIT = 48
const STORAGE_LOCK_STALE_MS = 15_000
const STORAGE_LOCK_TIMEOUT_MS = 10_000
const LOCK_LOG = process.env.DEBUG === '1'

const DEFAULT_SUBSIDY_PRESETS = [
  {
    id: 'preset-damage',
    name: '伤害补贴',
    levels: [
      { name: '第一', gold: 8000 },
      { name: '第二', gold: 5000 },
      { name: '第三', gold: 3000 },
    ],
  },
  {
    id: 'preset-heal',
    name: '治疗补贴',
    levels: [
      { name: '第一', gold: 5000 },
      { name: '第二', gold: 3000 },
    ],
  },
  {
    id: 'preset-tank',
    name: 'T补贴',
    levels: [
      { name: '第一', gold: 5000 },
      { name: '第二', gold: 3000 },
    ],
  },
]

function loadAdminQQs() {
  try {
    const config = JSON.parse(readFileSync(ADMIN_FILE, 'utf8'))
    return new Set(Array.isArray(config?.adminQQs) ? config.adminQQs.filter(item => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

const ADMIN_QQS = loadAdminQQs()

function normalizeSubsidyPresets(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const source = item
      const levels = Array.isArray(source.levels) ? source.levels : []
      return {
        id: typeof source.id === 'string' ? source.id : String(source.id ?? ''),
        name: typeof source.name === 'string' ? source.name : String(source.name ?? ''),
        levels: levels
          .filter(level => level && typeof level === 'object')
          .map(level => ({
            name: typeof level.name === 'string' ? level.name : String(level.name ?? ''),
            gold: Math.max(0, Number.isFinite(Number(level.gold)) ? Number(level.gold) : 0),
          }))
          .filter(level => level.name),
      }
    })
    .filter(item => item.id && item.name && item.levels.length > 0)
}

function isAdminQq(qq) {
  return typeof qq === 'string' && ADMIN_QQS.has(qq)
}

const store = createLevelStore({
  dbPath: LEVEL_DB_DIR,
  legacyDataFile: DATA_FILE,
  legacyLocksFile: LOCKS_FILE,
  backupDir: BACKUP_DIR,
  maxBackups: BACKUP_HISTORY_LIMIT,
  normalizeData,
  normalizeBackupData: normalizeHydratableData,
  normalizeLocks: normalizeLockData,
  normalizeSubsidyPresets,
  defaultSubsidyPresets: DEFAULT_SUBSIDY_PRESETS,
  validateData: validateSnapshotData,
})

const runtime = createRuntimeState({
  store,
  normalizeSubsidyPresets,
  isAdminQq,
  lockTimeout: LOCK_TIMEOUT,
})

async function withSharedStorage(callback) {
  return withFileLock(STORAGE_LOCK_FILE, callback, {
    staleMs: STORAGE_LOCK_STALE_MS,
    timeoutMs: STORAGE_LOCK_TIMEOUT_MS,
  })
}

function scheduleBackups() {
  const interval = setInterval(() => {
    void runtime.backupNow()
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
const apiV2 = express.Router()

function numberParam(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function lockTokenToTimestamp(lockToken) {
  const number = Number(lockToken)
  return Number.isFinite(number) ? number : undefined
}

function sendMutationError(res, error) {
  const details = error && typeof error === 'object' && 'details' in error ? error.details : undefined
  const message = error instanceof Error ? error.message : 'Mutation failed'
  if (details?.reason === 'teamLocked' || details?.reason === 'expired' || details?.reason === 'slotChanged') {
    return res.status(409).json({ ok: false, ...details })
  }
  return res.status(400).json({ ok: false, error: message })
}

async function runV2Mutation(res, mutation) {
  try {
    const data = await withSharedStorage(() => runtime.mutate(mutation))
    res.json({
      ok: true,
      data,
      dataVersion: data.dataVersion,
      lockVersion: data.lockVersion,
      patch: { type: mutation.type },
    })
  } catch (error) {
    sendMutationError(res, error)
  }
}

function extractBackupName(req) {
  return typeof req.params.name === 'string' ? req.params.name : req.body?.name
}

api.get('/version', (_req, res) => {
  res.type('application/json').send(runtime.getVersionJson())
})

api.get('/changes', (req, res) => {
  const dataVersion = Number(req.query.dataVersion)
  const lockVersion = Number(req.query.lockVersion)
  res.type('application/json').send(runtime.getChangesJson({
    dataVersion: Number.isFinite(dataVersion) ? dataVersion : undefined,
    lockVersion: Number.isFinite(lockVersion) ? lockVersion : undefined,
  }))
})

api.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(`event: hello\ndata: ${JSON.stringify(runtime.getVersion())}\n\n`)
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 25_000)
  heartbeat.unref?.()
  const unsubscribe = runtime.subscribe(event => {
    res.write(`event: version\ndata: ${JSON.stringify(event)}\n\n`)
  })
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

api.get('/data', async (_req, res) => {
  try {
    res.type('application/json').send(runtime.getPublicDataJson())
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load failed' })
  }
})

api.post('/data', async (req, res) => {
  try {
    await withSharedStorage(async () => {
      await runtime.replaceData(req.body, {
        allowReplace: req.get('x-teamassistant-replace') === '1',
      })
    })
    res.json({ ok: true })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : 500
    res.status(status).json({ ok: false, error: error instanceof Error ? error.message : 'Save failed' })
  }
})

api.get('/subsidy-presets', async (_req, res) => {
  try {
    res.json({ ok: true, presets: runtime.getSubsidyPresets() })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load subsidy presets failed' })
  }
})

api.post('/subsidy-presets', async (req, res) => {
  try {
    await withSharedStorage(() => runtime.updateSubsidyPresets(req.body?.presets))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Save subsidy presets failed' })
  }
})

api.get('/backups', async (_req, res) => {
  try {
    const backups = await withSharedStorage(() => store.listBackups())
    res.json({ ok: true, backups })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'List backups failed' })
  }
})

api.post('/backups', async (_req, res) => {
  try {
    const result = await withSharedStorage(async () => {
      const name = await runtime.backupNow()
      const backups = await store.listBackups()
      return { name, backups }
    })
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Backup failed' })
  }
})

api.post('/backups/restore', async (req, res) => {
  try {
    const { name } = req.body ?? {}
    if (typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing backup name' })
    }
    const result = await withSharedStorage(() => runtime.restoreBackup(name))
    res.json({
      ok: true,
      data: {
        ...result.data,
        subsidyPresets: normalizeSubsidyPresets(result.subsidyPresets),
      },
    })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Restore backup failed' })
  }
})

api.delete('/backups', async (req, res) => {
  try {
    const { name } = req.body ?? {}
    if (typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing backup name' })
    }
    const backups = await withSharedStorage(async () => {
      await store.deleteBackup(name)
      return store.listBackups()
    })
    res.json({ ok: true, backups })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Delete backup failed' })
  }
})

api.post(
  '/backups/import',
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ ok: false, error: 'Missing backup file' })
      }
      const result = await withSharedStorage(() => runtime.importBackup(req.body))
      res.json({
        ok: true,
        name: result.name,
        data: {
          ...result.data,
          subsidyPresets: normalizeSubsidyPresets(result.subsidyPresets),
        },
      })
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Import backup failed' })
    }
  },
)

api.post('/mutate', async (req, res) => {
  const { mutation } = req.body ?? {}
  if (!mutation?.type) {
    return res.status(400).json({ ok: false, error: 'Missing mutation' })
  }

  try {
    const data = await withSharedStorage(() => runtime.mutate(mutation))
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
    if (LOCK_LOG) {
      const counts = runtime.getLockCounts()
      console.log(`[lock] GET /locks → ${counts.slots} slots, ${counts.teams} teams`)
    }
    res.type('application/json').send(runtime.getPublicLocksJson())
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
    const result = runtime.acquireLock({ teamId, slotIndex, qq })
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
    runtime.releaseLock({ teamId, slotIndex, qq, lockTimestamp })
    if (LOCK_LOG) console.log(`[lock] RELEASED: ${teamId}:${slotIndex}`)
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
    const result = runtime.setTeamLock({ teamId })
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
    runtime.removeTeamLock({ teamId })
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
    const result = runtime.validateLock({ teamId, slotIndex, qq, lockTimestamp })
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

apiV2.get('/version', (_req, res) => {
  res.type('application/json').send(runtime.getVersionJson())
})

apiV2.get('/bootstrap', (_req, res) => {
  try {
    res.type('application/json').send(runtime.getPublicDataJson())
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load failed' })
  }
})

apiV2.get('/sync', (req, res) => {
  const dataVersion = Number(req.query.dataVersion)
  const lockVersion = Number(req.query.lockVersion)
  res.type('application/json').send(runtime.getChangesJson({
    dataVersion: Number.isFinite(dataVersion) ? dataVersion : undefined,
    lockVersion: Number.isFinite(lockVersion) ? lockVersion : undefined,
  }))
})

apiV2.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(`event: hello\ndata: ${JSON.stringify(runtime.getVersion())}\n\n`)
  const heartbeat = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 25_000)
  heartbeat.unref?.()
  const unsubscribe = runtime.subscribe(event => {
    res.write(`event: version\ndata: ${JSON.stringify(event)}\n\n`)
  })
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
})

apiV2.get('/locks', (_req, res) => {
  try {
    res.type('application/json').send(runtime.getPublicLocksJson())
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load failed' })
  }
})

apiV2.put('/data', async (req, res) => {
  try {
    await withSharedStorage(async () => {
      await runtime.replaceData(req.body, {
        allowReplace: req.get('x-teamassistant-replace') === '1',
      })
    })
    res.json({ ok: true })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : 500
    res.status(status).json({ ok: false, error: error instanceof Error ? error.message : 'Save failed' })
  }
})

apiV2.post('/slot-locks', (req, res) => {
  const { teamId, slotIndex, qq } = req.body
  if (!teamId || slotIndex == null || !qq) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }
  try {
    const result = runtime.acquireLock({ teamId, slotIndex, qq })
    res.json(result.ok ? { ...result, lockToken: result.timestamp } : result)
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Acquire failed' })
  }
})

apiV2.delete('/slot-locks/:teamId/:slotIndex', (req, res) => {
  const slotIndex = numberParam(req.params.slotIndex)
  if (!req.params.teamId || slotIndex == null) return res.status(400).json({ ok: false })
  try {
    runtime.releaseLock({
      teamId: req.params.teamId,
      slotIndex,
      qq: req.body?.qq,
      lockTimestamp: lockTokenToTimestamp(req.body?.lockToken),
    })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Release failed' })
  }
})

apiV2.post('/slot-locks/validate', (req, res) => {
  const { teamId, slotIndex, qq, lockToken } = req.body
  if (!teamId || slotIndex == null || !qq || !lockToken) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }

  try {
    const result = runtime.validateLock({ teamId, slotIndex, qq, lockTimestamp: lockTokenToTimestamp(lockToken) })
    if (result.ok) return res.json({ ok: true })
    if (result.reason === 'teamLocked') {
      return res.json({ ok: false, reason: 'teamLocked', lockedAt: result.lockedAt })
    }
    return res.json({ ok: false, reason: 'expired' })
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Validate failed' })
  }
})

apiV2.post('/teams', (req, res) => {
  const { team } = req.body ?? {}
  if (!team) return res.status(400).json({ ok: false, error: 'Missing team' })
  return runV2Mutation(res, { type: 'createTeam', team })
})

apiV2.patch('/teams/:teamId', (req, res) => {
  const { name, weekStart, note } = req.body ?? {}
  if (typeof name === 'string') {
    return runV2Mutation(res, { type: 'renameTeam', teamId: req.params.teamId, name })
  }
  if (typeof weekStart === 'string') {
    return runV2Mutation(res, { type: 'updateTeamWeekStart', teamId: req.params.teamId, weekStart })
  }
  if (typeof note === 'string') {
    return runV2Mutation(res, { type: 'updateTeamNote', teamId: req.params.teamId, note })
  }
  return res.status(400).json({ ok: false, error: 'Missing team update' })
})

apiV2.delete('/teams/:teamId', (req, res) => {
  return runV2Mutation(res, {
    type: 'deleteTeam',
    teamId: req.params.teamId,
    fallbackTeam: req.body?.fallbackTeam,
  })
})

apiV2.post('/teams/reorder', (req, res) => {
  return runV2Mutation(res, { type: 'reorderTeams', ids: Array.isArray(req.body?.ids) ? req.body.ids : [] })
})

apiV2.post('/teams/:teamId/archive', (req, res) => {
  return runV2Mutation(res, {
    type: 'archiveTeam',
    teamId: req.params.teamId,
    archivedBy: req.body?.archivedBy,
    archivedAt: req.body?.archivedAt,
    fallbackTeam: req.body?.fallbackTeam,
  })
})

apiV2.post('/archives/:archiveId/restore', (req, res) => {
  return runV2Mutation(res, {
    type: 'restoreArchivedTeam',
    archiveId: req.params.archiveId,
    actorQq: req.body?.actorQq,
    restoredAt: req.body?.restoredAt,
  })
})

apiV2.patch('/teams/:teamId/lock-state', (req, res) => {
  return runV2Mutation(res, {
    type: 'setTeamLockState',
    teamId: req.params.teamId,
    locked: Boolean(req.body?.locked),
  })
})

apiV2.put('/teams/:teamId/slots/:slotIndex/role', (req, res) => {
  const slotIndex = numberParam(req.params.slotIndex)
  if (slotIndex == null) return res.status(400).json({ ok: false, error: 'Invalid slot index' })
  return runV2Mutation(res, {
    type: 'setSlotRole',
    teamId: req.params.teamId,
    slotIndex,
    role: req.body?.role ?? null,
    martialArtIndex: req.body?.martialArtIndex ?? null,
    assignQQ: req.body?.assignQQ,
    actorQq: req.body?.actorQq,
  })
})

apiV2.post('/teams/:teamId/quick-reserve', (req, res) => {
  return runV2Mutation(res, {
    type: 'quickReserve',
    teamId: req.params.teamId,
    reserveType: req.body?.reserveType,
    count: Number(req.body?.count),
  })
})

apiV2.put('/teams/:teamId/slots/:slotIndex/member', (req, res) => {
  const slotIndex = numberParam(req.params.slotIndex)
  if (slotIndex == null || !req.body?.member) return res.status(400).json({ ok: false, error: 'Missing member update' })
  return runV2Mutation(res, {
    type: 'signupSlot',
    teamId: req.params.teamId,
    slotIndex,
    member: req.body.member,
    actorQq: req.body.actorQq,
    lockTimestamp: lockTokenToTimestamp(req.body.lockToken),
    expectedMemberQq: req.body.expectedMemberQq,
  })
})

apiV2.delete('/teams/:teamId/slots/:slotIndex/member', (req, res) => {
  const slotIndex = numberParam(req.params.slotIndex)
  if (slotIndex == null) return res.status(400).json({ ok: false, error: 'Invalid slot index' })
  return runV2Mutation(res, {
    type: 'leaveSlot',
    teamId: req.params.teamId,
    slotIndex,
    actorQq: req.body?.actorQq,
    lockTimestamp: lockTokenToTimestamp(req.body?.lockToken),
    expectedMemberQq: req.body?.expectedMemberQq,
  })
})

apiV2.post('/teams/:teamId/slots/:slotIndex/cancel', (req, res) => {
  const slotIndex = numberParam(req.params.slotIndex)
  if (slotIndex == null) return res.status(400).json({ ok: false, error: 'Invalid slot index' })
  return runV2Mutation(res, {
    type: 'cancelSlot',
    teamId: req.params.teamId,
    slotIndex,
    reason: req.body?.reason,
    cancelledBy: req.body?.cancelledBy,
    timestamp: req.body?.timestamp,
    actorQq: req.body?.actorQq,
    lockTimestamp: lockTokenToTimestamp(req.body?.lockToken),
    expectedMemberQq: req.body?.expectedMemberQq,
  })
})

apiV2.delete('/cancellations/:qq/:timestamp', (req, res) => {
  return runV2Mutation(res, {
    type: 'dismissCancellation',
    qq: req.params.qq,
    timestamp: Number(req.params.timestamp),
  })
})

apiV2.put('/user-profiles/:qq', (req, res) => {
  return runV2Mutation(res, { type: 'updateNickname', qq: req.params.qq, nickname: req.body?.nickname })
})

apiV2.put('/teams/:teamId/subsidy-types', (req, res) => {
  return runV2Mutation(res, {
    type: 'updateTeamSubsidyTypes',
    teamId: req.params.teamId,
    subsidyTypes: req.body?.subsidyTypes,
  })
})

apiV2.put('/teams/:teamId/subsidies/:qq', (req, res) => {
  return runV2Mutation(res, {
    type: 'registerMemberSubsidies',
    teamId: req.params.teamId,
    qq: req.params.qq,
    selections: req.body?.selections,
    weekStart: req.body?.weekStart,
  })
})

apiV2.put('/archives/:archiveId/subsidies/:qq', (req, res) => {
  return runV2Mutation(res, {
    type: 'registerMemberSubsidies',
    archiveId: req.params.archiveId,
    qq: req.params.qq,
    selections: req.body?.selections,
    weekStart: req.body?.weekStart,
  })
})

apiV2.post('/team-locks', (req, res) => {
  const { teamId } = req.body ?? {}
  if (!teamId) return res.status(400).json({ ok: false })
  try {
    const result = runtime.setTeamLock({ teamId })
    res.json({ ok: true, timestamp: result.timestamp })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Team lock failed' })
  }
})

apiV2.delete('/team-locks/:teamId', (req, res) => {
  try {
    runtime.removeTeamLock({ teamId: req.params.teamId })
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Team unlock failed' })
  }
})

apiV2.get('/subsidy-presets', (_req, res) => {
  try {
    res.json({ ok: true, presets: runtime.getSubsidyPresets() })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Load subsidy presets failed' })
  }
})

apiV2.put('/subsidy-presets', async (req, res) => {
  try {
    await withSharedStorage(() => runtime.updateSubsidyPresets(req.body?.presets))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Save subsidy presets failed' })
  }
})

apiV2.get('/backups', async (_req, res) => {
  try {
    const backups = await withSharedStorage(() => store.listBackups())
    res.json({ ok: true, backups })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'List backups failed' })
  }
})

apiV2.post('/backups', async (_req, res) => {
  try {
    const result = await withSharedStorage(async () => {
      const name = await runtime.backupNow()
      const backups = await store.listBackups()
      return { name, backups }
    })
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Backup failed' })
  }
})

apiV2.post('/backups/:name/restore', async (req, res) => {
  try {
    const name = extractBackupName(req)
    if (typeof name !== 'string') return res.status(400).json({ ok: false, error: 'Missing backup name' })
    const result = await withSharedStorage(() => runtime.restoreBackup(name))
    res.json({
      ok: true,
      data: {
        ...result.data,
        subsidyPresets: normalizeSubsidyPresets(result.subsidyPresets),
      },
    })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Restore backup failed' })
  }
})

apiV2.delete('/backups/:name', async (req, res) => {
  try {
    const name = extractBackupName(req)
    if (typeof name !== 'string') return res.status(400).json({ ok: false, error: 'Missing backup name' })
    const backups = await withSharedStorage(async () => {
      await store.deleteBackup(name)
      return store.listBackups()
    })
    res.json({ ok: true, backups })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Delete backup failed' })
  }
})

apiV2.post(
  '/backups/import',
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ ok: false, error: 'Missing backup file' })
      }
      const result = await withSharedStorage(() => runtime.importBackup(req.body))
      res.json({
        ok: true,
        name: result.name,
        data: {
          ...result.data,
          subsidyPresets: normalizeSubsidyPresets(result.subsidyPresets),
        },
      })
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Import backup failed' })
    }
  },
)

// Mount API router before static
app.use('/api/v2', apiV2)
app.use('/api', api)

// Static files
app.use(express.static(STATIC_DIR))

// SPA fallback
app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(STATIC_DIR, 'index.html'))
})

await store.init()
await runtime.init()
scheduleBackups()

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  if (LOCK_LOG) console.log('[lock] debug logging enabled')
})

async function shutdown() {
  server.close()
  await runtime.shutdown()
  await store.close()
}

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})
