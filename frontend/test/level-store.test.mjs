import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Level } from 'level'
import { gzip, gunzip } from 'zlib'
import { promisify } from 'util'

import {
  createLevelStore,
  decodeFromLevelValue,
  encodeForLevelValue,
} from '../../legacy-node/server/level-store.js'
import { normalizeData, normalizeHydratableData, validateSnapshotData } from '../../legacy-node/server/data-store.js'
import { normalizeLockData } from '../../legacy-node/server/lock-store.js'

const gunzipAsync = promisify(gunzip)
const gzipAsync = promisify(gzip)

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'teamassistant-level-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function createStore(dir, maxBackups = 48, options = {}) {
  return createLevelStore({
    dbPath: join(dir, 'leveldb'),
    legacyDataFile: join(dir, 'data.json'),
    legacyLocksFile: join(dir, 'locks.json'),
    backupDir: join(dir, 'backup'),
    maxBackups,
    normalizeData,
    normalizeBackupData: options.normalizeBackupData,
    normalizeLocks: normalizeLockData,
    normalizeSubsidyPresets: options.normalizeSubsidyPresets,
    defaultSubsidyPresets: options.defaultSubsidyPresets,
    validateData: validateSnapshotData,
  })
}

function createBackupTeam(id, name) {
  return {
    id,
    name,
    note: '',
    config: { reservedSlots: [], locked: false },
    slots: Array.from({ length: 25 }, (_, index) => ({
      index,
      status: 'empty',
      member: null,
      fixedRole: null,
      fixedMartialArtIndex: null,
    })),
  }
}

function normalizeTestPresets(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: String(item.id ?? ''),
      name: String(item.name ?? ''),
      levels: Array.isArray(item.levels)
        ? item.levels.map(level => ({
            name: String(level.name ?? ''),
            gold: Number(level.gold) || 0,
          })).filter(level => level.name)
        : [],
    }))
    .filter(item => item.id && item.name && item.levels.length > 0)
}

const defaultPreset = {
  id: 'preset-damage',
  name: '伤害补贴',
  levels: [{ name: '第一', gold: 8000 }],
}

const customPreset = {
  id: 'preset-custom',
  name: '自定义补贴',
  levels: [{ name: '高', gold: 5000 }],
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

test('level store fails startup instead of bootstrapping empty data from invalid legacy json', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'data.json'), '{ broken json')
    const store = createStore(dir)

    await assert.rejects(
      () => store.init(),
      /Failed to import legacy JSON data\.json/,
    )
    await store.close().catch(() => {})
  })
})

test('level store ignores invalid legacy json when level data already exists', async () => {
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

    await writeFile(join(dir, 'data.json'), '{ broken json')

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

    assert.equal(raw.teams[0].name.__teamAssistantEncoding, 'base64:utf16le')
    assert.equal(raw.teams[0].note.__teamAssistantEncoding, 'base64:utf16le')
    assert.equal(decodeFromLevelValue(raw).teams[0].name, '图片\uFFFC团')
  })
})

test('level store encoded strings preserve unpaired surrogate code units', () => {
  const source = { text: '异常输入\uD800结尾' }
  const encoded = encodeForLevelValue(source)
  assert.equal(encoded.text.__teamAssistantEncoding, 'base64:utf16le')
  assert.equal(decodeFromLevelValue(encoded).text, source.text)
})

test('level store still decodes legacy utf8 base64 strings', () => {
  const legacy = {
    text: {
      __teamAssistantEncoding: 'base64:utf8',
      value: Buffer.from('旧图片\uFFFC团', 'utf8').toString('base64'),
    },
  }
  assert.equal(decodeFromLevelValue(legacy).text, '旧图片\uFFFC团')
})

test('level store preserves special text, embedded images, and long notes through read and backup', async () => {
  await withTempDir(async (dir) => {
    const specialText = '角色\uFFFC 🌸🧑‍🚀\n第二行\t制表符'
    const imageData = `data:image/png;base64,${Buffer.from('fake image data').toString('base64')}`
    const longNote = `${specialText}\n${imageData}\n${'长文本'.repeat(500)}`
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{
        id: 'team-special',
        name: `图片团 ${specialText}`,
        note: longNote,
        config: { reservedSlots: [], locked: false },
        slots: [{
          index: 0,
          status: 'occupied',
          member: {
            qq: '10001',
            martialArtIndex: '0',
            gearScore: '1200',
            characterId: specialText,
            note: longNote,
          },
          fixedRole: null,
          fixedMartialArtIndex: null,
        }],
      }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const readBack = await store.readData()
    assert.equal(readBack.teams[0].name, `图片团 ${specialText}`)
    assert.equal(readBack.teams[0].note, longNote)
    assert.equal(readBack.teams[0].slots[0].member.characterId, specialText)
    assert.equal(readBack.teams[0].slots[0].member.note, longNote)

    const backupName = await store.backupNow(new Date('2026-01-01T02:00:00.000Z'))
    const backupBuffer = await gunzipAsync(await readFile(join(dir, 'backup', backupName)))
    const backup = JSON.parse(backupBuffer.toString('utf8'))
    assert.equal(backup.data.teams[0].slots[0].member.note, longNote)

    await store.close()
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
      'backup-2026-01-01T08-30-00-000+08-00.json.gz',
      'backup-2026-01-01T09-00-00-000+08-00.json.gz',
    ])

    const latestBuffer = await gunzipAsync(await readFile(join(dir, 'backup', backups[1])))
    const latest = JSON.parse(latestBuffer.toString('utf8'))
    assert.deepEqual(latest.data.teams, [])
    assert.deepEqual(latest.locks.slots, [])
    await store.close()
  })
})

test('level store keeps distinct files for backups created in the same millisecond', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{ id: 'team-same-time', name: '同毫秒备份', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const now = new Date('2026-01-01T02:30:00.000Z')
    const first = await store.backupNow(now)
    const second = await store.backupNow(now)

    assert.notEqual(first, second)
    assert.deepEqual((await store.listBackups()).map(item => item.name), [second, first])
    await store.close()
  })
})

test('level store lists and restores compressed backups', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [createBackupTeam('team-before', '备份前')],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const backupName = await store.backupNow(new Date('2026-01-01T03:00:00.000Z'))
    await store.writeData({
      teams: [{ id: 'team-after', name: '备份后', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const backups = await store.listBackups()
    assert.equal(backups[0].name, backupName)
    assert.equal(backups[0].createdAt, '2026-01-01T11:00:00.000+08:00')
    assert.equal(backups[0].size > 0, true)

    const restored = await store.restoreBackup(backupName)
    assert.equal(restored.data.teams[0].id, 'team-before')
    assert.equal((await store.readData()).teams[0].id, 'team-before')
    assert.deepEqual((await store.listBackups()).map(item => item.name), [backupName])
    await store.close()
  })
})

test('level store deletes backup files explicitly', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{ id: 'team-delete-backup', name: '删除备份', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const backupName = await store.backupNow(new Date('2026-01-01T03:30:00.000Z'))
    assert.equal((await store.listBackups()).length, 1)

    await store.deleteBackup(backupName)
    assert.deepEqual(await store.listBackups(), [])
    await assert.rejects(
      () => store.deleteBackup('../backup-2026-01-01T03-30-00-000Z.json.gz'),
      /Invalid backup name/,
    )
    await store.close()
  })
})

test('level store imports a compressed backup and restores it', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await store.writeData({
      teams: [{ id: 'team-current', name: '当前团', slots: [] }],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })

    const imported = {
      version: 1,
      createdAt: '2026-01-01T04:00:00.000Z',
      data: {
        teams: [createBackupTeam('team-imported', '导入团')],
        cancellations: [],
        archivedTeams: [],
        logs: [],
      },
      locks: { slots: [], teams: [] },
    }
    const result = await store.importBackup(
      await gzipAsync(Buffer.from(JSON.stringify(imported), 'utf8')),
      new Date('2026-01-01T04:30:00.000Z'),
    )

    assert.equal(result.name, 'backup-2026-01-01T12-30-00-000+08-00.json.gz')
    assert.equal(result.data.teams[0].id, 'team-imported')
    assert.equal((await store.readData()).teams[0].id, 'team-imported')
    assert.deepEqual((await store.listBackups()).map(item => item.name), [result.name])
    await store.close()
  })
})

test('level store initializes subsidy presets with defaults and preserves explicit empty presets', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 48, {
      normalizeSubsidyPresets: normalizeTestPresets,
      defaultSubsidyPresets: [defaultPreset],
    })
    await store.init()

    assert.deepEqual(await store.readSubsidyPresets(), [defaultPreset])
    await store.writeSubsidyPresets([])
    await store.close()

    const restartedStore = createStore(dir, 48, {
      normalizeSubsidyPresets: normalizeTestPresets,
      defaultSubsidyPresets: [defaultPreset],
    })
    await restartedStore.init()

    assert.deepEqual(await restartedStore.readSubsidyPresets(), [])
    await restartedStore.close()
  })
})

test('level store restores backup subsidy presets only when the backup contains them', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 48, {
      normalizeSubsidyPresets: normalizeTestPresets,
      defaultSubsidyPresets: [defaultPreset],
    })
    await store.init()
    await store.writeData({
      teams: [createBackupTeam('team-current', '当前团')],
      cancellations: [],
      archivedTeams: [],
      logs: [],
    })
    await store.writeSubsidyPresets([customPreset])
    await mkdir(join(dir, 'backup'), { recursive: true })

    await writeFile(join(dir, 'backup', 'backup-2026-01-01T04-00-00-000Z.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T04:00:00.000Z',
      data: { teams: [createBackupTeam('team-legacy', '旧备份')], cancellations: [], archivedTeams: [], logs: [] },
      locks: { slots: [], teams: [] },
    }))
    const legacyRestore = await store.restoreBackup('backup-2026-01-01T04-00-00-000Z.json')
    assert.deepEqual(legacyRestore.subsidyPresets, [customPreset])
    assert.deepEqual(await store.readSubsidyPresets(), [customPreset])

    await writeFile(join(dir, 'backup', 'backup-2026-01-01T04-30-00-000Z.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T04:30:00.000Z',
      data: { teams: [createBackupTeam('team-with-presets', '带预设备份')], cancellations: [], archivedTeams: [], logs: [] },
      locks: { slots: [], teams: [] },
      subsidyPresets: [defaultPreset],
    }))
    const presetRestore = await store.restoreBackup('backup-2026-01-01T04-30-00-000Z.json')
    assert.deepEqual(presetRestore.subsidyPresets, [defaultPreset])
    assert.deepEqual(await store.readSubsidyPresets(), [defaultPreset])

    await store.close()
  })
})

test('level store hydrates backup data before validation', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir, 48, { normalizeBackupData: normalizeHydratableData })
    await store.init()
    await mkdir(join(dir, 'backup'), { recursive: true })

    const team = {
      ...createBackupTeam('team-hydrated-backup', '旧周次备份'),
      weekStart: '2026-05-24',
      memberSubsidies: {
        10001: [{ typeId: 'damage', levelName: '高', weekStart: '2026-05-24' }],
      },
      subsidyTypes: [{
        id: 'damage',
        name: '伤害补贴',
        levels: [{ name: '高', gold: 500 }],
      }],
    }
    await writeFile(join(dir, 'backup', 'backup-2026-01-01T05-10-00-000Z.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T05:10:00.000Z',
      data: { teams: [team], cancellations: [], archivedTeams: [], logs: [] },
      locks: { slots: [], teams: [] },
    }))

    const restored = await store.restoreBackup('backup-2026-01-01T05-10-00-000Z.json')
    assert.equal(restored.data.teams[0].weekStart, '2026-05-18')
    assert.equal(restored.data.teams[0].memberSubsidies['10001'][0].weekStart, '2026-05-18')
    assert.equal((await store.readData()).teams[0].weekStart, '2026-05-18')
    await store.close()
  })
})

test('level store rejects backup restore payloads without teams', async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir)
    await store.init()
    await mkdir(join(dir, 'backup'), { recursive: true })
    await writeFile(join(dir, 'backup', 'backup-2026-01-01T05-00-00-000Z.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T05:00:00.000Z',
      data: { teams: [], cancellations: [], archivedTeams: [], logs: [] },
      locks: { slots: [], teams: [] },
    }))

    await assert.rejects(
      () => store.restoreBackup('backup-2026-01-01T05-00-00-000Z.json'),
      /Invalid backup data/,
    )
    await assert.rejects(
      () => store.importBackup(Buffer.from(JSON.stringify({ teams: [] }), 'utf8')),
      /Invalid backup data/,
    )

    await writeFile(join(dir, 'backup', 'backup-2026-01-01T05-30-00-000Z.json'), JSON.stringify({
      version: 1,
      createdAt: '2026-01-01T05:30:00.000Z',
      data: {
        teams: [{
          id: 'team-broken',
          name: '坏备份',
          note: '',
          config: { reservedSlots: [], locked: false },
          slots: [],
        }],
        cancellations: [],
        archivedTeams: [],
        logs: [],
      },
      locks: { slots: [], teams: [] },
    }))
    await assert.rejects(
      () => store.restoreBackup('backup-2026-01-01T05-30-00-000Z.json'),
      /Invalid backup data/,
    )
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
      'backup-2026-01-01T08-30-00-000+08-00.json.gz',
      'backup-2026-01-01T09-00-00-000+08-00.json.gz',
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
