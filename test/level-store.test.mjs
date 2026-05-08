import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Level } from 'level'
import { gunzip } from 'zlib'
import { promisify } from 'util'

import {
  createLevelStore,
  decodeFromLevelValue,
  encodeForLevelValue,
} from '../server/level-store.js'
import { normalizeData } from '../server/data-store.js'
import { normalizeLockData } from '../server/lock-store.js'

const gunzipAsync = promisify(gunzip)

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

test('level store imports legacy data json over empty bootstrap data', async () => {
  await withTempDir(async (dir) => {
    const emptyStore = createStore(dir)
    await emptyStore.init()
    assert.deepEqual((await emptyStore.readData()).teams, [])
    await emptyStore.close()

    await writeFile(join(dir, 'data.json'), JSON.stringify({
      teams: [{ id: 'team-legacy', name: '旧文本团', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    }))

    const migratedStore = createStore(dir)
    await migratedStore.init()

    assert.equal((await migratedStore.readData()).teams[0].id, 'team-legacy')
    await migratedStore.close()
  })
})

test('level store does not overwrite existing level data with legacy json', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{ id: 'team-level', name: '当前团', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })
    await store.close()

    await writeFile(join(dir, 'data.json'), JSON.stringify({
      teams: [{ id: 'team-legacy', name: '旧文本团', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    }))

    const restartedStore = createStore(dir)
    await restartedStore.init()

    assert.equal((await restartedStore.readData()).teams[0].id, 'team-level')
    await restartedStore.close()
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

test('level store backup writes compressed files and keeps configured history count', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 2)
    await store.init()
    await store.writeData({ teams: [], cancellations: [], archivedTeams: [], logs: [] })

    await store.backupNow(new Date('2026-01-01T00:00:00.000Z'))
    await store.backupNow(new Date('2026-01-01T00:30:00.000Z'))
    await store.backupNow(new Date('2026-01-01T01:00:00.000Z'))

    const backups = (await readdir(join(dir, 'backup'))).filter(name => name.endsWith('.json.gz')).sort()
    assert.deepEqual(backups, [
      'backup-2026-01-01T00-30-00-000Z.json.gz',
      'backup-2026-01-01T01-00-00-000Z.json.gz',
    ])

    const latestBuffer = await gunzipAsync(await readFile(join(dir, 'backup', backups[1])))
    const latest = JSON.parse(latestBuffer.toString('utf8'))
    assert.deepEqual(latest.data.teams, [])
    assert.deepEqual(latest.locks.slots, [])
    await store.close()
  })
})

test('level store backup pruning includes legacy uncompressed backups', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 2)
    await store.init()
    await mkdir(join(dir, 'backup'), { recursive: true })
    await writeFile(join(dir, 'backup', 'backup-2026-01-01T00-00-00-000Z.json'), '{}')

    await store.backupNow(new Date('2026-01-01T00:30:00.000Z'))
    await store.backupNow(new Date('2026-01-01T01:00:00.000Z'))

    const backups = (await readdir(join(dir, 'backup'))).sort()
    assert.deepEqual(backups, [
      'backup-2026-01-01T00-30-00-000Z.json.gz',
      'backup-2026-01-01T01-00-00-000Z.json.gz',
    ])
    await store.close()
  })
})

test('encoding round trip preserves buffers', () => {
  const source = { file: Buffer.from([1, 2, 3]) }
  const encoded = encodeForLevelValue(source)
  assert.equal(encoded.file.__teamAssistantEncoding, 'base64:binary')
  assert.deepEqual(decodeFromLevelValue(encoded).file, Buffer.from([1, 2, 3]))
})
