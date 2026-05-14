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
  normalizeLockData,
} from './lock-store.js'

const DATA_PERSIST_DEBOUNCE_MS = 250
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

function slotLockKey(teamId, slotIndex) {
  return `${teamId}:${slotIndex}`
}

function createLockState(lockData) {
  const normalized = normalizeLockData(lockData)
  const slotLocks = new Map()
  const teamLocks = new Map()
  for (const lock of normalized.slots) {
    slotLocks.set(slotLockKey(lock.teamId, lock.slotIndex), { ...lock })
  }
  for (const lock of normalized.teams) {
    teamLocks.set(lock.teamId, lock.timestamp)
  }
  return { slotLocks, teamLocks }
}

function cloneLockState(lockState) {
  return {
    slotLocks: new Map([...lockState.slotLocks].map(([key, lock]) => [key, { ...lock }])),
    teamLocks: new Map(lockState.teamLocks),
  }
}

function lockDataFromState(lockState) {
  return {
    slots: [...lockState.slotLocks.values()].map(lock => ({ ...lock })),
    teams: [...lockState.teamLocks].map(([teamId, timestamp]) => ({ teamId, timestamp })),
  }
}

function cleanExpiredLockState(lockState, lockTimeout, now = Date.now()) {
  const nextSlotLocks = new Map()
  let changed = false
  for (const [key, lock] of lockState.slotLocks) {
    if (now - lock.timestamp <= lockTimeout) {
      nextSlotLocks.set(key, { ...lock })
    } else {
      changed = true
    }
  }
  return {
    changed,
    lockState: {
      slotLocks: nextSlotLocks,
      teamLocks: new Map(lockState.teamLocks),
    },
  }
}

function acquireSlotLockFromState(lockState, { teamId, slotIndex, qq, lockTimeout, ignoreTeamLock = false, now = Date.now() }) {
  const teamLockTimestamp = lockState.teamLocks.get(teamId)
  if (!ignoreTeamLock && teamLockTimestamp) {
    return {
      changed: false,
      lockState,
      result: { ok: false, reason: 'teamLocked', lockedAt: teamLockTimestamp },
    }
  }

  const key = slotLockKey(teamId, slotIndex)
  const existing = lockState.slotLocks.get(key)
  if (existing && existing.qq !== qq && now - existing.timestamp < lockTimeout) {
    return {
      changed: false,
      lockState,
      result: { ok: false, lockedBy: existing.qq, lockedAt: existing.timestamp },
    }
  }

  const nextLockState = cloneLockState(lockState)
  nextLockState.slotLocks.set(key, { teamId, slotIndex, qq, timestamp: now })
  return {
    changed: true,
    lockState: nextLockState,
    result: { ok: true, timestamp: now },
  }
}

function releaseSlotLockFromState(lockState, { teamId, slotIndex, qq, lockTimestamp }) {
  const key = slotLockKey(teamId, slotIndex)
  const existing = lockState.slotLocks.get(key)
  if (!existing || existing.qq !== qq || (lockTimestamp && existing.timestamp !== lockTimestamp)) {
    return { changed: false, lockState }
  }

  const nextLockState = cloneLockState(lockState)
  nextLockState.slotLocks.delete(key)
  return { changed: true, lockState: nextLockState }
}

function setTeamLockInState(lockState, { teamId, timestamp = Date.now() }) {
  const nextLockState = cloneLockState(lockState)
  nextLockState.teamLocks.set(teamId, timestamp)
  return { changed: true, lockState: nextLockState, timestamp }
}

function removeTeamLockFromState(lockState, { teamId }) {
  if (!lockState.teamLocks.has(teamId)) {
    return { changed: false, lockState }
  }
  const nextLockState = cloneLockState(lockState)
  nextLockState.teamLocks.delete(teamId)
  return { changed: true, lockState: nextLockState }
}

function removeLocksForTeamFromState(lockState, { teamId }) {
  const nextLockState = cloneLockState(lockState)
  let changed = nextLockState.teamLocks.delete(teamId)
  for (const [key, lock] of nextLockState.slotLocks) {
    if (lock.teamId === teamId) {
      nextLockState.slotLocks.delete(key)
      changed = true
    }
  }
  return { changed, lockState: nextLockState }
}

export function createRuntimeState({
  store,
  normalizeSubsidyPresets,
  isAdminQq,
  lockTimeout,
}) {
  let data = normalizeHydratableData({})
  let locks = createLockState({})
  let subsidyPresets = normalizeSubsidyPresets([])
  let dataVersion = 1
  let lockVersion = 1
  let stateQueue = Promise.resolve()
  let dataPersistTimer = null
  let dataPersistPromise = Promise.resolve()
  let dataPersistDirty = false
  let lockPersistTimer = null
  let lockPersistPromise = Promise.resolve()
  let lockPersistDirty = false
  const listeners = new Set()

  function getVersion() {
    return {
      ok: true,
      dataVersion,
      lockVersion,
    }
  }

  function emitChange(type) {
    const event = {
      ok: true,
      type,
      dataVersion,
      lockVersion,
    }
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[events] listener failed:', error instanceof Error ? error.message : error)
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function publicLockState() {
    return lockDataFromState(locks)
  }

  function publicData() {
    const publicLocks = publicLockState()
    return {
      ...clone(data),
      locks: publicLocks.slots,
      teamLocks: publicLocks.teams,
      subsidyPresets: clone(subsidyPresets),
      dataVersion,
      lockVersion,
    }
  }

  function publicLocks() {
    return {
      ...publicLockState(),
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

  async function persistDataNow() {
    await store.writeData(normalizeData(clone(data)))
  }

  function scheduleDataPersist() {
    dataPersistDirty = true
    if (dataPersistTimer) return
    dataPersistTimer = setTimeout(() => {
      dataPersistTimer = null
      if (!dataPersistDirty) return
      dataPersistDirty = false
      dataPersistPromise = dataPersistPromise
        .then(() => persistDataNow())
        .catch(error => {
          dataPersistDirty = true
          console.error('[data] persist failed:', error instanceof Error ? error.message : error)
        })
    }, DATA_PERSIST_DEBOUNCE_MS)
    dataPersistTimer.unref?.()
  }

  async function flushData() {
    if (dataPersistTimer) {
      clearTimeout(dataPersistTimer)
      dataPersistTimer = null
    }
    if (dataPersistDirty) {
      dataPersistDirty = false
      dataPersistPromise = dataPersistPromise.then(() => persistDataNow())
    }
    await dataPersistPromise
  }

  async function persistLocksNow() {
    const nextLocks = normalizeLockData(lockDataFromState(locks))
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

  function replaceLocks(nextLocks, { persist = true, notify = true } = {}) {
    locks = nextLocks?.slotLocks instanceof Map ? cloneLockState(nextLocks) : createLockState(nextLocks)
    bumpLockVersion()
    if (persist) scheduleLockPersist()
    if (notify) emitChange('locks')
  }

  function cleanRuntimeLocks({ persist = true, notify = true } = {}) {
    const cleaned = cleanExpiredLockState(locks, lockTimeout)
    if (cleaned.changed) {
      replaceLocks(cleaned.lockState, { persist, notify })
    }
    return locks
  }

  async function init() {
    data = normalizeHydratableData(await store.readData())
    const cleanedLocks = cleanExpiredLockState(createLockState(await store.readLocks()), lockTimeout)
    locks = cloneLockState(cleanedLocks.lockState)
    subsidyPresets = normalizeSubsidyPresets(await store.readSubsidyPresets())
    if (cleanedLocks.changed) {
      await store.writeLocks(lockDataFromState(locks))
    }
  }

  async function shutdown() {
    await stateQueue
    await flushData()
    await flushLocks()
  }

  async function writeBackupNow() {
    await flushData()
    await flushLocks()
    return store.backupNow()
  }

  async function backupNow() {
    await stateQueue
    return writeBackupNow()
  }

  async function replaceData(body, { allowReplace }) {
    return enqueueStateWrite(async () => {
      await flushData()
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
      emitChange('data')
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
          slotLocks: locks.slotLocks,
          teamLocks: locks.teamLocks,
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
            ? setTeamLockInState(currentLocks, {
                teamId: mutation.teamId,
                timestamp: currentLocks.teamLocks.get(mutation.teamId) ?? Date.now(),
              })
            : removeTeamLockFromState(currentLocks, { teamId: mutation.teamId })
        ))
      }

      if (mutation.type === 'archiveTeam') {
        lockUpdates.push(currentLocks => removeLocksForTeamFromState(currentLocks, { teamId: mutation.teamId }))
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
      data = nextData
      bumpDataVersion()
      scheduleDataPersist()

      let locksChanged = false
      if (lockUpdates.length > 0) {
        let nextLocks = locks
        for (const updateLocks of lockUpdates) {
          const updatedLockState = updateLocks(nextLocks)
          nextLocks = updatedLockState.lockState
          locksChanged = locksChanged || updatedLockState.changed !== false
        }
        if (locksChanged) {
          replaceLocks(nextLocks, { notify: false })
        }
      }

      emitChange(locksChanged ? 'data' : 'data')
      return publicData()
    })
  }

  async function updateSubsidyPresets(presets) {
    return enqueueStateWrite(async () => {
      const nextPresets = normalizeSubsidyPresets(presets)
      await store.writeSubsidyPresets(nextPresets)
      subsidyPresets = nextPresets
      bumpDataVersion()
      emitChange('data')
      return clone(subsidyPresets)
    })
  }

  async function restoreBackup(name) {
    return enqueueStateWrite(async () => {
      await flushData()
      await flushLocks()
      const result = await store.restoreBackup(name)
      data = normalizeHydratableData(result.data)
      locks = createLockState(result.locks)
      subsidyPresets = normalizeSubsidyPresets(result.subsidyPresets)
      bumpDataVersion()
      bumpLockVersion()
      emitChange('data')
      return {
        ...result,
        data: publicData(),
      }
    })
  }

  async function importBackup(buffer) {
    return enqueueStateWrite(async () => {
      await flushData()
      await flushLocks()
      const result = await store.importBackup(buffer)
      data = normalizeHydratableData(result.data)
      locks = createLockState(result.locks)
      subsidyPresets = normalizeSubsidyPresets(result.subsidyPresets)
      bumpDataVersion()
      bumpLockVersion()
      emitChange('data')
      return {
        ...result,
        data: publicData(),
      }
    })
  }

  function acquireLock({ teamId, slotIndex, qq }) {
    cleanRuntimeLocks()
    const updated = acquireSlotLockFromState(locks, {
      teamId,
      slotIndex,
      qq,
      lockTimeout,
      ignoreTeamLock: isAdminQq(qq),
    })
    if (updated.changed) {
      replaceLocks(updated.lockState)
    }
    return updated.result
  }

  function releaseLock({ teamId, slotIndex, qq, lockTimestamp }) {
    cleanRuntimeLocks()
    const updated = releaseSlotLockFromState(locks, { teamId, slotIndex, qq, lockTimestamp })
    if (updated.changed) {
      replaceLocks(updated.lockState)
    }
    return { ok: true }
  }

  function setTeamRuntimeLock({ teamId }) {
    cleanRuntimeLocks()
    const updated = setTeamLockInState(locks, { teamId })
    replaceLocks(updated.lockState)
    return { ok: true, timestamp: updated.timestamp }
  }

  function removeTeamRuntimeLock({ teamId }) {
    cleanRuntimeLocks()
    const updated = removeTeamLockFromState(locks, { teamId })
    if (updated.changed) {
      replaceLocks(updated.lockState)
    }
    return { ok: true }
  }

  function validateLock({ teamId, slotIndex, qq, lockTimestamp }) {
    cleanRuntimeLocks()
    return validateSlotMutationLock({
      slotLocks: locks.slotLocks,
      teamLocks: locks.teamLocks,
      teamId,
      slotIndex,
      qq,
      lockTimestamp,
      lockTimeout,
      ignoreTeamLock: isAdminQq(qq),
    })
  }

  function getChanges({ dataVersion: sinceDataVersion, lockVersion: sinceLockVersion } = {}) {
    const dataChanged = sinceDataVersion !== dataVersion
    const lockChanged = sinceLockVersion !== lockVersion
    return {
      ok: true,
      dataVersion,
      lockVersion,
      dataChanged,
      lockChanged,
      ...(dataChanged ? { data: publicData() } : {}),
      ...(lockChanged ? { locks: publicLocks() } : {}),
    }
  }

  return {
    init,
    shutdown,
    subscribe,
    getVersion,
    getChanges,
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
    flushData,
    flushLocks,
  }
}
