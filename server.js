import express from 'express'
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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
// Team-level locks (in-memory, instantly propagated)
const teamLocks = new Set()
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
      return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
    }
  } catch { /* */ }
  return { teams: [], cancellations: [] }
}

async function saveData(data) {
  const release = await acquireWriteLock()
  try {
    writeFileSync(TMP_FILE, JSON.stringify(data, null, 2))
    renameSync(TMP_FILE, DATA_FILE)
  } catch {
    try { unlinkSync(TMP_FILE) } catch { /* */ }
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

// Dedicated locks endpoint (responds within 1s polling)
api.get('/locks', (_req, res) => {
  const sl = getLocks()
  const tl = [...teamLocks]
  if (LOCK_LOG) console.log(`[lock] GET /locks → ${sl.length} slots, ${tl.length} teams`)
  res.json({ slots: sl, teams: tl })
})

api.post('/lock', (req, res) => {
  const { teamId, slotIndex, qq } = req.body
  if (!teamId || slotIndex == null || !qq) {
    return res.status(400).json({ ok: false, error: 'Missing fields' })
  }
  cleanLocks()
  const key = `${teamId}:${slotIndex}`
  const existing = slotLocks.get(key)
  if (existing && existing.qq !== qq && Date.now() - existing.timestamp < LOCK_TIMEOUT) {
    if (LOCK_LOG) console.log(`[lock] CONFLICT: ${key} locked by ${existing.qq}`)
    return res.json({ ok: false, lockedBy: existing.qq })
  }
  slotLocks.set(key, { qq, timestamp: Date.now() })
  if (LOCK_LOG) console.log(`[lock] ACQUIRED: ${key} by ${qq}`)
  res.json({ ok: true })
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

// Team-level lock API
api.post('/team-lock', (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  teamLocks.add(teamId)
  if (LOCK_LOG) console.log(`[lock] TEAM LOCKED: ${teamId}`)
  res.json({ ok: true })
})

api.delete('/team-lock', (req, res) => {
  const { teamId } = req.body
  if (!teamId) return res.status(400).json({ ok: false })
  teamLocks.delete(teamId)
  if (LOCK_LOG) console.log(`[lock] TEAM UNLOCKED: ${teamId}`)
  res.json({ ok: true })
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
