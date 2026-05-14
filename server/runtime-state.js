import {
  applyMutation,
  normalizeHydratableData,
  normalizeData,
  validateDataReplacement,
  validateExpectedSlotMember,
  validateSnapshotData,
  validateSlotMutationLock,
} from './data-store.js'
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
} from './lock-store.js'

const LOCK_PERSIST_DEBOUNCE_MS = 2_000

function clone(value) {
  return structuredClone(value)
}

function createHttpError(message, status = 400, details) {
  const error = new Error(message)
  error.status = status
  if (details) error.details = details
  return error
}

export function createRuntimeState({
  store,
  normalizeSubsidyPresets,
  isAdminQq,
  lockTimeout,
}) {
  let data = normalizeHydratableData({})
  let locks = normalizeLockData({})
  let subsidyPresets = normalizeSubsidyPresets([])
  let dataVersion = 1
  let lockVersion = 1
  let stateQueue = Promise.resolve()
  let lockPersistTimer = null
  let lockPersistPromise = Promise.resolve()
  let lockPersistDirty = false

  function getVersion() {
    return {
      ok: true,
      dataVersion,
      lockVersion,
    }
  }

  function publicData() {
    return {
      ...clone(data),
      locks: getPublicLocks(locks).slots,
      subsidyPresets: clone(subsidyPresets),
      dataVersion,
      lockVersion,
    }
  }

  function publicLocks() {
    const publicState = getPublicLocks(locks)
    return {
      ...clone(publicState),
      lockVersion,
    }
  }

  function bumpDataVersion() {
    dataVersion += 1
  }

  function bumpLockVersion() {
    lockVersion += 1
  }

  function enqueueStateWrite(task) {
    const run = stateQueue.then(task, task)
    stateQueue = run.catch(() => {})
    return run
  }

  async function persistLocksNow() {
    const nextLocks = normalizeLockData(locks)
    await store.writeLocks(nextLocks)
  }

  function scheduleLockPersist() {
    lockPersistDirty = true
    if (lockPersistTimer) return
    lockPersistTimer = setTimeout(() => {
      lockPersistTimer = null
      if (!lockPersistDirty) return
      lockPersistDirty = false
      lockPersistPromise = lockPersistPromise
        .then(() => persistLocksNow())
        .catch(error => {
          lockPersistDirty = true
          console.error('[locks] persist failed:', error instanceof Error ? error.message : error)
        })
    }, LOCK_PERSIST_DEBOUNCE_MS)
    lockPersistTimer.unref?.()
  }

  async function flushLocks() {
    if (lockPersistTimer) {
      clearTimeout(lockPersistTimer)
      lockPersistTimer = null
    }
    if (lockPersistDirty) {
      lockPersistDirty = false
      lockPersistPromise = lockPersistPromise.then(() => persistLocksNow())
    }
    await lockPersistPromise
  }

  function replaceLocks(nextLocks, { persist = true } = {}) {
    locks = normalizeLockData(nextLocks)
    bumpLockVersion()
    if (persist) scheduleLockPersist()
  }

  function cleanRuntimeLocks({ persist = true } = {}) {
    const cleaned = cleanExpiredLocks(locks, lockTimeout)
    if (cleaned.changed) {
      replaceLocks(cleaned.lockData, { persist })
    }
    return locks
  }

  async function init() {
    data = normalizeHydratableData(await store.readData())
    const cleanedLocks = cleanExpiredLocks(await store.readLocks(), lockTimeout)
    locks = normalizeLockData(cleanedLocks.lockData)
    subsidyPresets = normalizeSubsidyPresets(await store.readSubsidyPresets())
    if (cleanedLocks.changed) {
      await store.writeLocks(locks)
    }
  }

  async function shutdown() {
    await stateQueue
    await flushLocks()
  }

  async function writeBackupNow() {
    await flushLocks()
    return store.backupNow()
  }

  async function backupNow() {
    await stateQueue
    return writeBackupNow()
  }

  async function replaceData(body, { allowReplace }) {
    return enqueueStateWrite(async () => {
      const validation = validateDataReplacement(data, body, { allowReplace })
      if (!validation.ok) {
        throw createHttpError(validation.error, validation.status)
      }
      if (validation.shouldBackup) {
        await writeBackupNow()
      }
      const nextData = normalizeHydratableData(validation.data)
      await store.writeData(normalizeData(nextData))
      data = nextData
      bumpDataVersion()
      return publicData()
    })
  }

  async function mutate(mutation) {
    return enqueueStateWrite(async () => {
      cleanRuntimeLocks()
      const lockUpdates = []
      const actorQq = mutation.actorQq ?? mutation.member?.qq ?? mutation.cancelledBy

      if (mutation.type === 'signupSlot' || mutation.type === 'leaveSlot' || mutation.type === 'cancelSlot') {
        const lockResult = validateSlotMutationLock({
          slotLocks: buildSlotLockMap(locks),
          teamLocks: buildTeamLockMap(locks),
          teamId: mutation.teamId,
          slotIndex: mutation.slotIndex,
          qq: actorQq,
          lockTimestamp: mutation.lockTimestamp,
          lockTimeout,
          ignoreTeamLock: isAdminQq(actorQq),
        })
        if (!lockResult.ok) {
          throw createHttpError(lockResult.reason, 409, lockResult)
        }
      }

      if (mutation.type === 'setTeamLockState') {
        lockUpdates.push(currentLocks => (
          mutation.locked
            ? setTeamLock(currentLocks, {
                teamId: mutation.teamId,
                timestamp: getTeamLockTimestamp(currentLocks, mutation.teamId) ?? Date.now(),
              })
            : removeTeamLock(currentLocks, { teamId: mutation.teamId })
        ))
      }

      if (mutation.type === 'archiveTeam') {
        lockUpdates.push(currentLocks => removeLocksForTeam(currentLocks, { teamId: mutation.teamId }))
      }

      if (
        (mutation.type === 'signupSlot' || mutation.type === 'leaveSlot' || mutation.type === 'cancelSlot') &&
        Object.prototype.hasOwnProperty.call(mutation, 'expectedMemberQq')
      ) {
        const expected = validateExpectedSlotMember(data, mutation.teamId, mutation.slotIndex, mutation.expectedMemberQq)
        if (!expected.ok) {
          throw createHttpError(expected.reason, 409, expected)
        }
      }

      const mutated = normalizeData(applyMutation(data, mutation))
      if (!validateSnapshotData(mutated)) {
        throw createHttpError('Invalid mutation snapshot', 400)
      }

      const nextData = normalizeHydratableData(mutated)
      await store.writeData(nextData)
      data = nextData
      bumpDataVersion()

      if (lockUpdates.length > 0) {
        let nextLocks = locks
        let locksChanged = false
        for (const updateLocks of lockUpdates) {
          const updatedLockState = updateLocks(nextLocks)
          nextLocks = updatedLockState.lockData
          locksChanged = locksChanged || updatedLockState.changed !== false
        }
        if (locksChanged) {
          replaceLocks(nextLocks)
        }
      }

      return publicData()
    })
  }

  async function updateSubsidyPresets(presets) {
    return enqueueStateWrite(async () => {
      const nextPresets = normalizeSubsidyPresets(presets)
      await store.writeSubsidyPresets(nextPresets)
      subsidyPresets = nextPresets
      bumpDataVersion()
      return clone(subsidyPresets)
    })
  }

  async function restoreBackup(name) {
    return enqueueStateWrite(async () => {
      await flushLocks()
      const result = await store.restoreBackup(name)
      data = normalizeHydratableData(result.data)
      locks = normalizeLockData(result.locks)
      subsidyPresets = normalizeSubsidyPresets(result.subsidyPresets)
      bumpDataVersion()
      bumpLockVersion()
      return {
        ...result,
        data: publicData(),
      }
    })
  }

  async function importBackup(buffer) {
    return enqueueStateWrite(async () => {
      await flushLocks()
      const result = await store.importBackup(buffer)
      data = normalizeHydratableData(result.data)
      locks = normalizeLockData(result.locks)
      subsidyPresets = normalizeSubsidyPresets(result.subsidyPresets)
      bumpDataVersion()
      bumpLockVersion()
      return {
        ...result,
        data: publicData(),
      }
    })
  }

  function acquireLock({ teamId, slotIndex, qq }) {
    cleanRuntimeLocks()
    const updated = acquireSlotLock(locks, {
      teamId,
      slotIndex,
      qq,
      lockTimeout,
      ignoreTeamLock: isAdminQq(qq),
    })
    if (updated.changed) {
      replaceLocks(updated.lockData)
    }
    return updated.result
  }

  function releaseLock({ teamId, slotIndex, qq, lockTimestamp }) {
    cleanRuntimeLocks()
    const updated = releaseSlotLock(locks, { teamId, slotIndex, qq, lockTimestamp })
    if (updated.changed) {
      replaceLocks(updated.lockData)
    }
    return { ok: true }
  }

  function setTeamRuntimeLock({ teamId }) {
    cleanRuntimeLocks()
    const updated = setTeamLock(locks, { teamId })
    replaceLocks(updated.lockData)
    return { ok: true, timestamp: updated.timestamp }
  }

  function removeTeamRuntimeLock({ teamId }) {
    cleanRuntimeLocks()
    const updated = removeTeamLock(locks, { teamId })
    if (updated.changed) {
      replaceLocks(updated.lockData)
    }
    return { ok: true }
  }

  function validateLock({ teamId, slotIndex, qq, lockTimestamp }) {
    cleanRuntimeLocks()
    return validateSlotMutationLock({
      slotLocks: buildSlotLockMap(locks),
      teamLocks: buildTeamLockMap(locks),
      teamId,
      slotIndex,
      qq,
      lockTimestamp,
      lockTimeout,
      ignoreTeamLock: isAdminQq(qq),
    })
  }

  return {
    init,
    shutdown,
    getVersion,
    getPublicData: publicData,
    getPublicLocks: publicLocks,
    getSubsidyPresets: () => clone(subsidyPresets),
    replaceData,
    mutate,
    updateSubsidyPresets,
    backupNow,
    restoreBackup,
    importBackup,
    acquireLock,
    releaseLock,
    setTeamLock: setTeamRuntimeLock,
    removeTeamLock: removeTeamRuntimeLock,
    validateLock,
    flushLocks,
  }
}
