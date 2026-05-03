import express from 'express'
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { applyMutation, normalizeData, validateExpectedSlotMember, validateSlotMutationLock } from './server/data-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000
const DATA_FILE = join(__dirname, 'data.json')
const TMP_FILE = DATA_FILE + '.tmp'
const LOCK_TIMEOUT = 30_000

// Write lock - serialize all file writes to prevent corruption
let writeLock = Promise.resolve()

function acquireWriteLock() {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const prev = writeLock
  writeLock = writeLock.then(() => wait)
  return prev.then(() => release)
}

// Slot editing locks (in-memory, key: "teamId:slotIndex")
const slotLocks = new Map()
// Team-level locks (in-memory, teamId → timestamp)
const teamLocks = new Map()
const LOCK_LOG = process.env.DEBUG === '1'

function cleanLocks() {
  const now = Date.now()
  for (const [key, lock] of slotLocks) {
    if (now - lock.timestamp > LOCK_TIMEOUT) {
      if (LOCK_LOG) console.log(`[lock] expired: ${key}`)
      slotLocks.delete(key)
    }
  }
}

function getLocks() {
  cleanLocks()
  const result = []
  for (const [key, lock] of slotLocks) {
    const [teamId, slotIndex] = key.split(':')
    result.push({ teamId, slotIndex: parseInt(slotIndex), qq: lock.qq, timestamp: lock.timestamp })
  }
  return result
}

function loadData() {
  try {
    if (existsSync(DATA_FILE)) {
      return normalizeData(JSON.parse(readFileSync(DATA_FILE, 'utf-8')))
    }
  } catch { /* */ }
  return { teams: [], cancellations: [] }
}

async function saveData(data) {
  const release = await acquireWriteLock()
  try {
    writeFileSync(TMP_FILE, JSON.stringify(normalizeData(data), null, 2))
    renameSync(TMP_FILE, DATA_FILE)
  } catch {
    try { unlinkSync(TMP_FILE) } catch { /* */ }
  } finally {
    release()
  }
}

async function mutateData(mutator) {
  const release = await acquireWriteLock()
  try {
    const current = loadData()
    const next = normalizeData(await mutator(current))
    writeFileSync(TMP_FILE, JSON.stringify(next, null, 2))
    renameSync(TMP_FILE, DATA_FILE)
    return next
  } catch (error) {
    try { unlinkSync(TMP_FILE) } catch { /* */ }
    throw error
  } finally {
    release()
  }
}

app.use(express.json({ limit: '10mb' }))

// API router - mounted before static, ensures API routes take priority
const api = express.Router()

api.get('/data', (_req, res) => {
  const data = loadData()
  data.locks = getLocks()
  res.json(data)
})

api.post('/data', async (req, res) => {
  await saveData(req.body)
  res.json({ ok: true })
})

api.post('/mutate', async (req, res) => {
  const { mutation } = req.body ?? {}
  if (!mutation?.type) {
    return res.status(400).json({ ok: false, error: 'Missing mutation' })
  }

  try {
    const data = await mutateData(current => {
      if (mutation.type === 'signupSlot' || mutation.type === 'leaveSlot' || mutation.type === 'cancelSlot') {
        const lockResult = validateSlotMutationLock({
          slotLocks,
          teamLocks,
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

      return applyMutation(current, mutation)
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
api.get('/locks', (_req, res) => {
  const sl = getLocks()
  const tl = []
  for (const [teamId, ts] of teamLocks) {
    tl.push({ teamId, timestamp: ts })
  }
  if (LOCK_LOG) console.log(`[lock] GET /locks → ${sl.length} slots, ${tl.length} teams`)
  res.json({ slots: sl, teams: tl })
})

api.post('/lock', (req, res) => {
  const { teamId, slotIndex, qq } = req.body
  if (!teamId || slotIndex == null || !qq) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }
  cleanLocks()
  // Check team lock
  const teamLockTime = teamLocks.get(teamId)
  if (teamLockTime) {
    return res.json({ ok: false, reason: 'teamLocked', lockedAt: teamLockTime })
  }
  const key = `${teamId}:${slotIndex}`
  const existing = slotLocks.get(key)
  const now = Date.now()
  if (existing && existing.qq !== qq && now - existing.timestamp < LOCK_TIMEOUT) {
    if (LOCK_LOG) console.log(`[lock] CONFLICT: ${key} locked by ${existing.qq} at ${existing.timestamp}`)
    return res.json({ ok: false, lockedBy: existing.qq, lockedAt: existing.timestamp })
  }
  slotLocks.set(key, { qq, timestamp: now })
  if (LOCK_LOG) console.log(`[lock] ACQUIRED: ${key} by ${qq} at ${now}`)
  res.json({ ok: true, timestamp: now })
})

api.delete('/lock', (req, res) => {
  const { teamId, slotIndex, qq } = req.body
  if (LOCK_LOG) console.log(`[lock] RELEASE: ${teamId}:${slotIndex} by ${qq}`)
  if (!teamId || slotIndex == null) {
    return res.status(400).json({ ok: false })
  }
  const key = `${teamId}:${slotIndex}`
  const existing = slotLocks.get(key)
  if (!existing || existing.qq === qq) {
    slotLocks.delete(key)
    if (LOCK_LOG) console.log(`[lock] RELEASED: ${key}`)
  }
  res.json({ ok: true })
})

// Team-level lock API (stores timestamp for conflict resolution)
api.post('/team-lock', (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  const now = Date.now()
  teamLocks.set(teamId, now)
  if (LOCK_LOG) console.log(`[lock] TEAM LOCKED: ${teamId} at ${now}`)
  res.json({ ok: true, timestamp: now })
})

api.delete('/team-lock', (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  teamLocks.delete(teamId)
  if (LOCK_LOG) console.log(`[lock] TEAM UNLOCKED: ${teamId}`)
  res.json({ ok: true })
})

// Validate lock before save (checks team locks and slot locks by timestamp)
api.post('/validate-lock', (req, res) => {
  const { teamId, slotIndex, qq, lockTimestamp } = req.body
  if (!teamId || slotIndex == null || !qq || !lockTimestamp) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }
  // Check if team was locked after slot lock was acquired
  const teamLockTime = teamLocks.get(teamId)
  if (teamLockTime && teamLockTime > lockTimestamp) {
    return res.json({ ok: false, reason: 'teamLocked', lockedAt: teamLockTime })
  }
  // Check if slot lock is still held by this user with matching timestamp
  const key = `${teamId}:${slotIndex}`
  const existing = slotLocks.get(key)
  if (!existing || existing.qq !== qq) {
    return res.json({ ok: false, reason: 'expired' })
  }
  // If lock was refreshed (newer timestamp), check if still by same user
  if (existing.timestamp > lockTimestamp) {
    // Lock was refreshed by heartbeat - still valid for same user
    if (existing.qq === qq) {
      return res.json({ ok: true })
    }
    return res.json({ ok: false, reason: 'expired' })
  }
  // Lock timestamp matches or is older (heartbeat might have updated it)
  if (existing.qq === qq) {
    return res.json({ ok: true })
  }
  return res.json({ ok: false, reason: 'expired' })
})

// Mount API router before static
app.use('/api', api)

// Static files
app.use(express.static(join(__dirname, 'dist')))

// SPA fallback
app.get('/{*splat}', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  if (LOCK_LOG) console.log('[lock] debug logging enabled')
})
