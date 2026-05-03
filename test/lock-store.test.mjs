import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  acquireSlotLock,
  cleanExpiredLocks,
  readLockData,
  removeTeamLock,
  setTeamLock,
  writeLockData,
} from '../server/lock-store.js'
import { withFileLock } from '../server/shared-file-lock.js'

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'teamassistant-locks-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('withFileLock serializes concurrent access on shared lock file', async () => {
  await withTempDir(async (dir) => {
    const lockFile = join(dir, '.storage.lock')
    const steps = []

    const first = withFileLock(lockFile, async () => {
      steps.push('first-start')
      await new Promise(resolve => setTimeout(resolve, 40))
      steps.push('first-end')
    }, { retryMs: 5, timeoutMs: 500 })

    const second = withFileLock(lockFile, async () => {
      steps.push('second-start')
      steps.push('second-end')
    }, { retryMs: 5, timeoutMs: 500 })

    await Promise.all([first, second])
    assert.deepEqual(steps, ['first-start', 'first-end', 'second-start', 'second-end'])
  })
})

test('lock data written by one instance is visible to another instance', async () => {
  await withTempDir(async (dir) => {
    const lockFile = join(dir, 'locks.json')
    const tmpFile = `${lockFile}.tmp`

    const acquired = acquireSlotLock(readLockData(lockFile), {
      teamId: 'team-1',
      slotIndex: 4,
      qq: '10001',
      lockTimeout: 30_000,
      now: 1000,
    })
    writeLockData(lockFile, tmpFile, acquired.lockData)

    const conflict = acquireSlotLock(readLockData(lockFile), {
      teamId: 'team-1',
      slotIndex: 4,
      qq: '10002',
      lockTimeout: 30_000,
      now: 1001,
    })

    assert.equal(conflict.result.ok, false)
    assert.equal(conflict.result.lockedBy, '10001')
  })
})

test('team lock stored in shared file blocks slot acquisition until removed', async () => {
  await withTempDir(async (dir) => {
    const lockFile = join(dir, 'locks.json')
    const tmpFile = `${lockFile}.tmp`

    const teamLocked = setTeamLock(readLockData(lockFile), {
      teamId: 'team-1',
      timestamp: 5000,
    })
    writeLockData(lockFile, tmpFile, teamLocked.lockData)

    const blocked = acquireSlotLock(readLockData(lockFile), {
      teamId: 'team-1',
      slotIndex: 0,
      qq: '10001',
      lockTimeout: 30_000,
      now: 5001,
    })
    assert.equal(blocked.result.ok, false)
    assert.equal(blocked.result.reason, 'teamLocked')

    const unlocked = removeTeamLock(readLockData(lockFile), {
      teamId: 'team-1',
    })
    writeLockData(lockFile, tmpFile, unlocked.lockData)

    const acquired = acquireSlotLock(readLockData(lockFile), {
      teamId: 'team-1',
      slotIndex: 0,
      qq: '10001',
      lockTimeout: 30_000,
      now: 5002,
    })
    assert.equal(acquired.result.ok, true)
  })
})

test('cleanExpiredLocks removes stale slot locks but keeps team locks', async () => {
  const cleaned = cleanExpiredLocks({
    slots: [
      { teamId: 'team-1', slotIndex: 0, qq: '10001', timestamp: 1000 },
      { teamId: 'team-1', slotIndex: 1, qq: '10002', timestamp: 5002 },
    ],
    teams: [{ teamId: 'team-1', timestamp: 9000 }],
  }, 2000, 7001)

  assert.equal(cleaned.changed, true)
  assert.deepEqual(cleaned.lockData.slots, [
    { teamId: 'team-1', slotIndex: 1, qq: '10002', timestamp: 5002 },
  ])
  assert.deepEqual(cleaned.lockData.teams, [
    { teamId: 'team-1', timestamp: 9000 },
  ])
})
