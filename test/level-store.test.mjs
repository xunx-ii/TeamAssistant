import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Level } from 'level'

import {
  createLevelStore,
  decodeFromLevelValue,
  encodeForLevelValue,
} from '../server/level-store.js'
import { normalizeData } from '../server/data-store.js'
import { normalizeLockData } from '../server/lock-store.js'

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'teamassistant-level-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function createStore(dir, maxBackups = 48) {
  return createLevelStore({
    dbPath: join(dir, 'leveldb'),
    legacyDataFile: join(dir, 'data.json'),
    legacyLocksFile: join(dir, 'locks.json'),
    backupDir: join(dir, 'backup'),
    maxBackups,
    normalizeData,
    normalizeLocks: normalizeLockData,
  })
}

test('level store migrates legacy json data and locks', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'data.json'), JSON.stringify({
      teams: [{ id: 'team-1', name: '旧团', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    }))
    await writeFile(join(dir, 'locks.json'), JSON.stringify({
      slots: [{ teamId: 'team-1', slotIndex: 1, qq: '10001', timestamp: 123 }],
      teams: [],
    }))

    const store = createStore(dir)
    await store.init()
    await rm(join(dir, 'data.json'), { force: true })
    await rm(join(dir, 'locks.json'), { force: true })

    assert.equal((await store.readData()).teams[0].name, '旧团')
    assert.equal((await store.readLocks()).slots[0].qq, '10001')
    await store.close()
  })
})

test('level store base64 encodes non-text input before writing raw values', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{
        id: 'team-1',
        name: '图片\uFFFC团',
        note: 'data:image/png;base64,AAAA',
        config: { reservedSlots: [], locked: false },
        slots: [],
      }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })
    await store.close()

    const db = new Level(join(dir, 'leveldb'), { valueEncoding: 'json' })
    const raw = await db.get('app:data')
    await db.close()

    assert.equal(raw.teams[0].name.__teamAssistantEncoding, 'base64:utf8')
    assert.equal(raw.teams[0].note.__teamAssistantEncoding, 'base64:utf8')
    assert.equal(decodeFromLevelValue(raw).teams[0].name, '图片\uFFFC团')
  })
})

test('level store backup keeps configured history count', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 2)
    await store.init()
    await store.writeData({ teams: [], cancellations: [], archivedTeams: [], logs: [] })

    await store.backupNow(new Date('2026-01-01T00:00:00.000Z'))
    await store.backupNow(new Date('2026-01-01T00:30:00.000Z'))
    await store.backupNow(new Date('2026-01-01T01:00:00.000Z'))

    const backups = (await readdir(join(dir, 'backup'))).filter(name => name.endsWith('.json')).sort()
    assert.deepEqual(backups, [
      'backup-2026-01-01T00-30-00-000Z.json',
      'backup-2026-01-01T01-00-00-000Z.json',
    ])

    const latest = JSON.parse(await readFile(join(dir, 'backup', backups[1]), 'utf8'))
    assert.deepEqual(latest.data.teams, [])
    assert.deepEqual(latest.locks.slots, [])
    await store.close()
  })
})

test('encoding round trip preserves buffers', () => {
  const source = { file: Buffer.from([1, 2, 3]) }
  const encoded = encodeForLevelValue(source)
  assert.equal(encoded.file.__teamAssistantEncoding, 'base64:binary')
  assert.deepEqual(decodeFromLevelValue(encoded).file, Buffer.from([1, 2, 3]))
})
