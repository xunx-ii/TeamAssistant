import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

function isValidSlotLock(lock) {
  return Boolean(
    lock &&
    typeof lock.teamId === 'string' &&
    Number.isInteger(lock.slotIndex) &&
    typeof lock.qq === 'string' &&
    typeof lock.timestamp === 'number',
  )
}

function isValidTeamLock(lock) {
  return Boolean(
    lock &&
    typeof lock.teamId === 'string' &&
    typeof lock.timestamp === 'number',
  )
}

export function normalizeLockData(data) {
  return {
    slots: Array.isArray(data?.slots) ? data.slots.filter(isValidSlotLock) : [],
    teams: Array.isArray(data?.teams) ? data.teams.filter(isValidTeamLock) : [],
  }
}

export function readLockData(lockFile) {
  try {
    if (existsSync(lockFile)) {
      return normalizeLockData(JSON.parse(readFileSync(lockFile, 'utf-8')))
    }
  } catch { /* */ }
  return { slots: [], teams: [] }
}

export function writeLockData(lockFile, tmpFile, data) {
  try {
    writeFileSync(tmpFile, JSON.stringify(normalizeLockData(data), null, 2))
    renameSync(tmpFile, lockFile)
  } catch (error) {
    try { unlinkSync(tmpFile) } catch { /* */ }
    throw error
  }
}

export function cleanExpiredLocks(lockData, lockTimeout, now = Date.now()) {
  const normalized = normalizeLockData(lockData)
  const nextSlots = normalized.slots.filter(lock => now - lock.timestamp <= lockTimeout)
  return {
    changed: nextSlots.length !== normalized.slots.length,
    lockData: {
      slots: nextSlots,
      teams: normalized.teams,
    },
  }
}

export function buildSlotLockMap(lockData) {
  const map = new Map()
  for (const lock of normalizeLockData(lockData).slots) {
    map.set(`${lock.teamId}:${lock.slotIndex}`, lock)
  }
  return map
}

export function buildTeamLockMap(lockData) {
  const map = new Map()
  for (const lock of normalizeLockData(lockData).teams) {
    map.set(lock.teamId, lock.timestamp)
  }
  return map
}

export function getPublicLocks(lockData) {
  const normalized = normalizeLockData(lockData)
  return {
    slots: normalized.slots,
    teams: normalized.teams,
  }
}

export function acquireSlotLock(lockData, { teamId, slotIndex, qq, lockTimeout, now = Date.now() }) {
  const normalized = normalizeLockData(lockData)
  const teamLock = normalized.teams.find(lock => lock.teamId === teamId)
  if (teamLock) {
    return {
      changed: false,
      lockData: normalized,
      result: { ok: false, reason: 'teamLocked', lockedAt: teamLock.timestamp },
    }
  }

  const key = `${teamId}:${slotIndex}`
  const existing = normalized.slots.find(lock => `${lock.teamId}:${lock.slotIndex}` === key)
  if (existing && existing.qq !== qq && now - existing.timestamp < lockTimeout) {
    return {
      changed: false,
      lockData: normalized,
      result: { ok: false, lockedBy: existing.qq, lockedAt: existing.timestamp },
    }
  }

  const nextSlots = normalized.slots.filter(lock => `${lock.teamId}:${lock.slotIndex}` !== key)
  nextSlots.push({ teamId, slotIndex, qq, timestamp: now })
  return {
    changed: true,
    lockData: {
      slots: nextSlots,
      teams: normalized.teams,
    },
    result: { ok: true, timestamp: now },
  }
}

export function releaseSlotLock(lockData, { teamId, slotIndex, qq, lockTimestamp }) {
  const normalized = normalizeLockData(lockData)
  const key = `${teamId}:${slotIndex}`
  const existing = normalized.slots.find(lock => `${lock.teamId}:${lock.slotIndex}` === key)
  if (!existing) {
    return {
      changed: false,
      lockData: normalized,
    }
  }

  if (existing.qq !== qq) {
    return { changed: false, lockData: normalized }
  }

  if (lockTimestamp && existing.timestamp !== lockTimestamp) {
    return {
      changed: false,
      lockData: normalized,
    }
  }

  return {
    changed: true,
    lockData: {
      slots: normalized.slots.filter(lock => `${lock.teamId}:${lock.slotIndex}` !== key),
      teams: normalized.teams,
    },
  }
}

export function setTeamLock(lockData, { teamId, timestamp = Date.now() }) {
  const normalized = normalizeLockData(lockData)
  const nextTeams = normalized.teams.filter(lock => lock.teamId !== teamId)
  nextTeams.push({ teamId, timestamp })
  return {
    changed: true,
    lockData: {
      slots: normalized.slots,
      teams: nextTeams,
    },
    timestamp,
  }
}

export function removeTeamLock(lockData, { teamId }) {
  const normalized = normalizeLockData(lockData)
  const nextTeams = normalized.teams.filter(lock => lock.teamId !== teamId)
  return {
    changed: nextTeams.length !== normalized.teams.length,
    lockData: {
      slots: normalized.slots,
      teams: nextTeams,
    },
  }
}

export function getTeamLockTimestamp(lockData, teamId) {
  return normalizeLockData(lockData).teams.find(lock => lock.teamId === teamId)?.timestamp
}
