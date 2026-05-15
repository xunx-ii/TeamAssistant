import type { ArchivedTeam, Cancellation, Member, MemberSubsidySelection, OperationLog, Slot, SubsidyType, Team, UserProfiles } from './types'
import { normalizeTeamName } from './teamName'
import { normalizeWeekStartKey } from './week'

export interface Snapshot {
  teams: Team[]
  cancellations: Cancellation[]
  archivedTeams: ArchivedTeam[]
  logs: OperationLog[]
  userProfiles: UserProfiles
}

export type Mutation =
  | { type: 'createTeam'; team: Team }
  | { type: 'deleteTeam'; teamId: string; fallbackTeam?: Team }
  | { type: 'archiveTeam'; teamId: string; archivedBy: string; archivedAt?: number; fallbackTeam?: Team }
  | { type: 'restoreArchivedTeam'; archiveId: string; actorQq: string; restoredAt?: number }
  | { type: 'renameTeam'; teamId: string; name: string }
  | { type: 'updateTeamWeekStart'; teamId: string; weekStart: string }
  | { type: 'updateTeamNote'; teamId: string; note: string }
  | { type: 'reorderTeams'; ids: string[] }
  | { type: 'toggleTeamConfigLock'; teamId: string; locked: boolean }
  | { type: 'setTeamLockState'; teamId: string; locked: boolean }
  | {
      type: 'setSlotRole'
      teamId: string
      slotIndex: number
      role: 'T' | '治疗' | 'DPS' | 'boss' | null
      martialArtIndex: number | null
      assignQQ?: string
      actorQq?: string
    }
  | { type: 'quickReserve'; teamId: string; reserveType: 'T' | '治疗' | 'boss'; count: number }
  | {
      type: 'signupSlot'
      teamId: string
      slotIndex: number
      member: Member
      actorQq?: string
      lockTimestamp?: number
      expectedMemberQq?: string | null
    }
  | {
      type: 'cancelSlot'
      teamId: string
      slotIndex: number
      reason: string
      cancelledBy: string
      timestamp?: number
      actorQq?: string
      lockTimestamp?: number
      expectedMemberQq?: string | null
    }
  | {
      type: 'leaveSlot'
      teamId: string
      slotIndex: number
      actorQq?: string
      lockTimestamp?: number
      expectedMemberQq?: string | null
    }
  | { type: 'dismissCancellation'; qq: string; timestamp: number }
  | { type: 'updateNickname'; qq: string; nickname: string }
  | { type: 'updateTeamSubsidyTypes'; teamId: string; subsidyTypes: SubsidyType[] }
  | { type: 'registerMemberSubsidies'; teamId?: string; archiveId?: string; qq: string; selections: MemberSubsidySelection[]; weekStart?: string }

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  const cloned = structuredClone(snapshot) as Partial<Snapshot>
  return {
    teams: Array.isArray(cloned.teams) ? cloned.teams : [],
    cancellations: Array.isArray(cloned.cancellations) ? cloned.cancellations : [],
    archivedTeams: Array.isArray(cloned.archivedTeams) ? cloned.archivedTeams : [],
    logs: Array.isArray(cloned.logs) ? cloned.logs : [],
    userProfiles: isPlainObject(cloned.userProfiles) ? cloned.userProfiles as UserProfiles : {},
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  return String(value)
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function setRecordValue<T>(record: Record<string, T>, key: unknown, value: T) {
  Object.defineProperty(record, toText(key), {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function getRecordValue<T>(record: Record<string, T>, key: unknown): T | undefined {
  return Object.getOwnPropertyDescriptor(record, toText(key))?.value as T | undefined
}

function normalizeNickname(value: unknown): string {
  const normalized = toText(value)
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(normalized).slice(0, 20).join('')
}

function normalizeMember(member: unknown): Member {
  if (!isPlainObject(member)) {
    throw new Error('Invalid member')
  }
  const normalized: Member = {
    qq: toText(member.qq),
    martialArtIndex: toText(member.martialArtIndex),
    gearScore: toText(member.gearScore),
    characterId: toText(member.characterId),
    note: toText(member.note),
  }
  if ('hasOrangeWeapon' in member) {
    normalized.hasOrangeWeapon = Boolean(member.hasOrangeWeapon)
  }
  return normalized
}

function normalizeSubsidyTypes(subsidyTypes: unknown): SubsidyType[] {
  if (!Array.isArray(subsidyTypes)) {
    throw new Error('Invalid subsidy types')
  }
  return subsidyTypes
    .filter(isPlainObject)
    .map(type => ({
      id: toText(type.id),
      name: toText(type.name),
      levels: Array.isArray(type.levels)
        ? type.levels
            .filter(isPlainObject)
            .map(level => ({
              name: toText(level.name),
              gold: Math.max(0, toFiniteNumber(level.gold)),
            }))
        : [],
    }))
}

function normalizeWeekStart(value: unknown): string {
  return normalizeWeekStartKey(value)
}

function normalizeMemberSubsidySelections(selections: unknown): MemberSubsidySelection[] {
  if (!Array.isArray(selections)) {
    throw new Error('Invalid member subsidy selections')
  }
  return selections
    .filter(isPlainObject)
    .map(selection => {
      const normalized: MemberSubsidySelection = {
        typeId: toText(selection.typeId),
        levelName: toText(selection.levelName),
      }
      const weekStart = normalizeWeekStart(selection.weekStart)
      if (weekStart) {
        normalized.weekStart = weekStart
      }
      return normalized
    })
}

function getTeamOrThrow(snapshot: Snapshot, teamId: string): Team {
  const team = snapshot.teams.find(item => item.id === teamId)
  if (!team) {
    throw new Error(`Team not found: ${teamId}`)
  }
  return team
}

function getArchiveOrThrow(snapshot: Snapshot, archiveId: string): ArchivedTeam {
  const archive = snapshot.archivedTeams.find(item => item.id === archiveId)
  if (!archive) {
    throw new Error(`Archive not found: ${archiveId}`)
  }
  return archive
}

function getSubsidyTeamOrThrow(snapshot: Snapshot, mutation: Extract<Mutation, { type: 'registerMemberSubsidies' }>): Team {
  if (mutation.archiveId) {
    return getArchiveOrThrow(snapshot, mutation.archiveId).team
  }
  if (!mutation.teamId) {
    throw new Error('Missing subsidy team')
  }
  return getTeamOrThrow(snapshot, mutation.teamId)
}

function appendLog(snapshot: Snapshot, team: Team, actorQq: string, action: string, timestamp = Date.now()) {
  snapshot.logs.push({
    id: `${timestamp}-${team.id}-${snapshot.logs.length + 1}`,
    teamId: team.id,
    teamName: team.name,
    timestamp,
    actorQq: toText(actorQq),
    action: toText(action),
  })
}

function getResetStatus(team: Team, slotIndex: number) {
  const slot = team.slots[slotIndex]
  if (!slot) {
    throw new Error(`Slot not found: ${slotIndex}`)
  }
  if (slot.fixedRole || slot.fixedMartialArtIndex !== null) {
    return 'fixed' as const
  }
  if (team.config.reservedSlots.includes(slotIndex)) {
    return 'reserved' as const
  }
  return 'empty' as const
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right)
}

function getQuickReserveOrder(reserveType: 'T' | '治疗' | 'boss', slotCount: number) {
  const allSlots = Array.from({ length: slotCount }, (_, index) => index)
  const priorityStart = reserveType === 'T' ? 20 : reserveType === '治疗' ? 15 : null
  if (priorityStart === null) return allSlots

  const priority = Array.from({ length: 5 }, (_, offset) => priorityStart + offset)
    .filter(index => index < slotCount)
  const prioritySet = new Set(priority)
  return [...priority, ...allSlots.filter(index => !prioritySet.has(index))]
}

function normalizeSnapshotData(data: unknown): Snapshot {
  const source = isPlainObject(data) ? data : {}
  return {
    teams: Array.isArray(source.teams) ? source.teams as Team[] : [],
    cancellations: Array.isArray(source.cancellations) ? source.cancellations as Cancellation[] : [],
    archivedTeams: Array.isArray(source.archivedTeams) ? source.archivedTeams as ArchivedTeam[] : [],
    logs: Array.isArray(source.logs) ? source.logs as OperationLog[] : [],
    userProfiles: isPlainObject(source.userProfiles) ? source.userProfiles as UserProfiles : {},
  }
}

function isSlotIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 25
}

function isValidMember(member: unknown): member is Member {
  return Boolean(
    isPlainObject(member) &&
    typeof member.qq === 'string' &&
    typeof member.martialArtIndex === 'string' &&
    typeof member.gearScore === 'string' &&
    typeof member.characterId === 'string' &&
    typeof member.note === 'string' &&
    (!Object.prototype.hasOwnProperty.call(member, 'hasOrangeWeapon') || typeof member.hasOrangeWeapon === 'boolean'),
  )
}

function isValidSlot(slot: unknown, index: number): slot is Slot {
  if (
    !isPlainObject(slot) ||
    slot.index !== index ||
    !['empty', 'occupied', 'reserved', 'fixed'].includes(toText(slot.status)) ||
    !(slot.member === null || isValidMember(slot.member)) ||
    !(slot.fixedRole === null || ['T', '治疗', 'DPS'].includes(toText(slot.fixedRole))) ||
    !(slot.fixedMartialArtIndex === null || Number.isInteger(slot.fixedMartialArtIndex))
  ) {
    return false
  }

  if (slot.status === 'occupied') {
    return isValidMember(slot.member)
  }

  return slot.member === null
}

function isValidTeamConfig(config: unknown) {
  return Boolean(
    isPlainObject(config) &&
    Array.isArray(config.reservedSlots) &&
    config.reservedSlots.every(isSlotIndex) &&
    typeof config.locked === 'boolean',
  )
}

function isValidWeekStart(weekStart: unknown) {
  return weekStart === undefined || (typeof weekStart === 'string' && normalizeWeekStart(weekStart) === weekStart)
}

function isValidSubsidyTypes(subsidyTypes: unknown) {
  if (subsidyTypes === undefined) return true
  return Array.isArray(subsidyTypes) && subsidyTypes.every(type => (
    isPlainObject(type) &&
    typeof type.id === 'string' &&
    typeof type.name === 'string' &&
    Array.isArray(type.levels) &&
    type.levels.every(level => (
      isPlainObject(level) &&
      typeof level.name === 'string' &&
      Number.isFinite(level.gold)
    ))
  ))
}

function isValidMemberSubsidies(memberSubsidies: unknown) {
  if (memberSubsidies === undefined) return true
  return isPlainObject(memberSubsidies) && Object.values(memberSubsidies).every(selections => (
    Array.isArray(selections) &&
    selections.every(selection => (
      isPlainObject(selection) &&
      typeof selection.typeId === 'string' &&
      typeof selection.levelName === 'string' &&
      (!Object.prototype.hasOwnProperty.call(selection, 'weekStart') || isValidWeekStart(selection.weekStart))
    ))
  ))
}

function isValidSnapshotTeam(team: unknown): team is Team {
  return Boolean(
    isPlainObject(team) &&
    typeof team.id === 'string' &&
    typeof team.name === 'string' &&
    typeof team.note === 'string' &&
    isValidWeekStart(team.weekStart) &&
    isValidTeamConfig(team.config) &&
    Array.isArray(team.slots) &&
    team.slots.length === 25 &&
    team.slots.every((slot, index) => isValidSlot(slot, index)) &&
    isValidSubsidyTypes(team.subsidyTypes) &&
    isValidMemberSubsidies(team.memberSubsidies),
  )
}

function isValidArchivedTeam(archive: unknown): archive is ArchivedTeam {
  return Boolean(
    isPlainObject(archive) &&
    typeof archive.id === 'string' &&
    Number.isFinite(archive.archivedAt) &&
    typeof archive.archivedBy === 'string' &&
    isValidSnapshotTeam(archive.team),
  )
}

function isValidUserProfiles(userProfiles: unknown) {
  return isPlainObject(userProfiles) && Object.values(userProfiles).every(profile => (
    isPlainObject(profile) &&
    typeof profile.nickname === 'string' &&
    normalizeNickname(profile.nickname) === profile.nickname &&
    Array.from(profile.nickname).length <= 20
  ))
}

export function validateSnapshotData(data: unknown) {
  const snapshot = normalizeSnapshotData(data)
  return (
    snapshot.teams.length > 0 &&
    snapshot.teams.every(isValidSnapshotTeam) &&
    snapshot.archivedTeams.every(isValidArchivedTeam) &&
    isValidUserProfiles(snapshot.userProfiles)
  )
}

export function validateDataReplacement(currentData: unknown, incomingData: unknown, { allowReplace = false } = {}) {
  const current = normalizeSnapshotData(currentData)
  const incoming = normalizeSnapshotData(incomingData)

  if (incoming.teams.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Refusing to save an empty team snapshot',
    }
  }

  if (!validateSnapshotData(incoming)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid team snapshot',
    }
  }

  if (current.teams.length > 0 && !allowReplace) {
    return {
      ok: false,
      status: 409,
      error: 'Full data replacement requires explicit confirmation',
    }
  }

  return {
    ok: true,
    data: incoming,
    shouldBackup: current.teams.length > 0,
  }
}

export function validateExpectedSlotMember(
  data: unknown,
  teamId: string,
  slotIndex: number,
  expectedMemberQq?: string | null,
) {
  const team = getTeamOrThrow(normalizeSnapshotData(data), teamId)
  const slot = team.slots[slotIndex]
  if (!slot) {
    throw new Error(`Slot not found: ${slotIndex}`)
  }
  const currentMemberQq = slot.member?.qq ?? null
  if (currentMemberQq !== (expectedMemberQq ?? null)) {
    return {
      ok: false,
      reason: 'slotChanged',
      currentMemberQq,
    }
  }
  return { ok: true }
}

interface SlotMutationLockOptions {
  slotLocks: Map<string, { qq: string; timestamp: number }>
  teamLocks: Map<string, number>
  teamId?: string
  slotIndex?: number | null
  qq?: string
  lockTimestamp?: number | null
  lockTimeout: number
  ignoreTeamLock?: boolean
  now?: number
}

export function validateSlotMutationLock({
  slotLocks,
  teamLocks,
  teamId,
  slotIndex,
  qq,
  lockTimestamp,
  lockTimeout,
  ignoreTeamLock = false,
  now = Date.now(),
}: SlotMutationLockOptions) {
  if (!teamId || slotIndex == null || !qq || !lockTimestamp) {
    return { ok: false, reason: 'missingFields' }
  }

  const teamLockTime = teamLocks.get(teamId)
  if (!ignoreTeamLock && teamLockTime && teamLockTime > lockTimestamp) {
    return { ok: false, reason: 'teamLocked', lockedAt: teamLockTime }
  }

  const existing = slotLocks.get(`${teamId}:${slotIndex}`)
  if (!existing || existing.qq !== qq) {
    return { ok: false, reason: 'expired' }
  }

  if (now - existing.timestamp > lockTimeout) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true }
}

export function applyMutation(snapshot: Snapshot, mutation: Mutation): Snapshot {
  const next = cloneSnapshot(snapshot)

  switch (mutation.type) {
    case 'createTeam': {
      const team = {
        ...mutation.team,
        name: normalizeTeamName(mutation.team.name, '默认团队'),
      }
      const weekStart = normalizeWeekStart(mutation.team.weekStart)
      if (weekStart) team.weekStart = weekStart
      else delete team.weekStart
      next.teams.push(team)
      return next
    }

    case 'deleteTeam':
      next.teams = next.teams.filter(team => team.id !== mutation.teamId)
      if (next.teams.length === 0 && mutation.fallbackTeam) {
        next.teams.push(mutation.fallbackTeam)
      }
      return next

    case 'archiveTeam': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const archivedAt = mutation.archivedAt ?? Date.now()
      next.archivedTeams.push({
        id: `${team.id}-${archivedAt}`,
        team,
        archivedAt,
        archivedBy: mutation.archivedBy,
      })
      appendLog(next, team, mutation.archivedBy, '归档表格', archivedAt)
      next.teams = next.teams.filter(item => item.id !== mutation.teamId)
      if (next.teams.length === 0 && mutation.fallbackTeam) {
        next.teams.push(mutation.fallbackTeam)
      }
      return next
    }

    case 'restoreArchivedTeam': {
      const archive = getArchiveOrThrow(next, mutation.archiveId)
      const restoredAt = mutation.restoredAt ?? Date.now()
      next.teams.push(archive.team)
      next.archivedTeams = next.archivedTeams.filter(item => item.id !== mutation.archiveId)
      appendLog(next, archive.team, mutation.actorQq, '恢复表格', restoredAt)
      return next
    }

    case 'renameTeam': {
      const team = getTeamOrThrow(next, mutation.teamId)
      team.name = normalizeTeamName(mutation.name, team.name)
      return next
    }

    case 'updateTeamWeekStart': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const weekStart = normalizeWeekStart(mutation.weekStart)
      if (weekStart) team.weekStart = weekStart
      return next
    }

    case 'updateTeamNote': {
      const team = getTeamOrThrow(next, mutation.teamId)
      team.note = toText(mutation.note)
      return next
    }

    case 'reorderTeams': {
      const teamMap = new Map(next.teams.map(team => [team.id, team]))
      const ordered = mutation.ids
        .map(id => teamMap.get(id))
        .filter((team): team is Team => Boolean(team))
      const orderedIds = new Set(ordered.map(team => team.id))
      next.teams = [...ordered, ...next.teams.filter(team => !orderedIds.has(team.id))]
      return next
    }

    case 'toggleTeamConfigLock': {
      const team = getTeamOrThrow(next, mutation.teamId)
      team.config.locked = mutation.locked
      return next
    }

    case 'setTeamLockState': {
      const team = getTeamOrThrow(next, mutation.teamId)
      team.config.locked = mutation.locked
      return next
    }

    case 'setSlotRole': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const slot = team.slots[mutation.slotIndex]
      if (!slot) {
        throw new Error(`Slot not found: ${mutation.slotIndex}`)
      }

      if (mutation.role === 'boss') {
        team.config.reservedSlots = uniqueSorted([...team.config.reservedSlots, mutation.slotIndex])
        slot.status = 'reserved'
        slot.member = null
        slot.fixedRole = null
        slot.fixedMartialArtIndex = null
        return next
      }

      team.config.reservedSlots = team.config.reservedSlots.filter(index => index !== mutation.slotIndex)

      if (mutation.role === null) {
        slot.status = 'empty'
        slot.member = null
        slot.fixedRole = null
        slot.fixedMartialArtIndex = null
        return next
      }

      if (mutation.assignQQ && mutation.martialArtIndex != null) {
        slot.status = 'occupied'
        slot.member = {
          qq: mutation.assignQQ,
          martialArtIndex: String(mutation.martialArtIndex),
          gearScore: '',
          characterId: '',
          note: '',
        }
        slot.fixedRole = null
        slot.fixedMartialArtIndex = null
        appendLog(next, team, mutation.actorQq ?? mutation.assignQQ, `指定 #${mutation.slotIndex + 1} 报名：${mutation.assignQQ}`)
        return next
      }

      slot.status = 'fixed'
      slot.member = null
      slot.fixedRole = mutation.role
      slot.fixedMartialArtIndex = mutation.martialArtIndex
      return next
    }

    case 'quickReserve': {
      const team = getTeamOrThrow(next, mutation.teamId)
      let reserved = [...team.config.reservedSlots]
      const reserveOrder = getQuickReserveOrder(mutation.reserveType, team.slots.length)
      const current = mutation.reserveType === 'boss'
        ? reserved.length
        : team.slots.filter(slot => slot.status === 'fixed' && slot.fixedRole === mutation.reserveType).length

      if (mutation.reserveType === 'boss') {
        if (mutation.count < current) {
          const toRemove = reserved.slice(mutation.count)
          reserved = reserved.filter(index => !toRemove.includes(index))
          for (const slotIndex of toRemove) {
            const slot = team.slots[slotIndex]
            if (!slot) continue
            slot.status = 'empty'
            slot.member = null
            slot.fixedRole = null
            slot.fixedMartialArtIndex = null
          }
        } else {
          let need = mutation.count - current
          for (let index = 0; index < team.slots.length && need > 0; index += 1) {
            const slot = team.slots[index]
            if (slot.status === 'empty' && !reserved.includes(index)) {
              reserved.push(index)
              slot.status = 'reserved'
              slot.member = null
              slot.fixedRole = null
              slot.fixedMartialArtIndex = null
              need -= 1
            }
          }
        }
      } else if (mutation.count < current) {
        const reserveRank = new Map(reserveOrder.map((slotIndex, rank) => [slotIndex, rank]))
        const toReset = team.slots
          .filter(slot => slot.status === 'fixed' && slot.fixedRole === mutation.reserveType)
          .sort((left, right) => {
            const leftRank = reserveRank.get(left.index) ?? left.index
            const rightRank = reserveRank.get(right.index) ?? right.index
            return leftRank - rightRank
          })
          .slice(mutation.count)
        for (const slot of toReset) {
          slot.status = 'empty'
          slot.member = null
          slot.fixedRole = null
          slot.fixedMartialArtIndex = null
        }
      } else {
        let need = mutation.count - current
        for (const index of reserveOrder) {
          if (need <= 0) break
          const slot = team.slots[index]
          if (slot.status === 'empty' && !reserved.includes(index)) {
            slot.status = 'fixed'
            slot.member = null
            slot.fixedRole = mutation.reserveType
            slot.fixedMartialArtIndex = null
            need -= 1
          }
        }
      }

      team.config.reservedSlots = uniqueSorted(reserved)
      return next
    }

    case 'signupSlot': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const slot = team.slots[mutation.slotIndex]
      if (!slot) {
        throw new Error(`Slot not found: ${mutation.slotIndex}`)
      }
      const isUpdate = Boolean(slot.member)
      const member = normalizeMember(mutation.member)
      slot.status = 'occupied'
      slot.member = member
      const action = isUpdate
        ? `修改 #${mutation.slotIndex + 1} 报名：${member.characterId}`
        : `报名 #${mutation.slotIndex + 1}：${member.characterId}`
      appendLog(next, team, mutation.actorQq ?? member.qq, action)
      return next
    }

    case 'cancelSlot': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const slot = team.slots[mutation.slotIndex]
      if (!slot?.member) {
        return next
      }
      next.cancellations.push({
        qq: slot.member.qq,
        reason: toText(mutation.reason),
        cancelledBy: toText(mutation.cancelledBy),
        teamId: team.id,
        teamName: team.name,
        slotIndex: mutation.slotIndex,
        timestamp: mutation.timestamp ?? Date.now(),
      })
      appendLog(next, team, mutation.cancelledBy, `取消 #${mutation.slotIndex + 1} 报名：${slot.member.characterId}`)
      slot.status = getResetStatus(team, mutation.slotIndex)
      slot.member = null
      return next
    }

    case 'leaveSlot': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const slot = team.slots[mutation.slotIndex]
      if (!slot) {
        throw new Error(`Slot not found: ${mutation.slotIndex}`)
      }
      const characterId = slot.member?.characterId ?? ''
      appendLog(next, team, mutation.actorQq ?? slot.member?.qq ?? '', `退出 #${mutation.slotIndex + 1} 报名${characterId ? `：${characterId}` : ''}`)
      slot.status = getResetStatus(team, mutation.slotIndex)
      slot.member = null
      return next
    }

    case 'dismissCancellation':
      next.cancellations = next.cancellations.filter(item => (
        item.qq !== mutation.qq || item.timestamp !== mutation.timestamp
      ))
      return next

    case 'updateNickname': {
      const qq = toText(mutation.qq)
      const nickname = normalizeNickname(mutation.nickname)
      if (!qq || !nickname) return next
      if (!next.userProfiles) {
        next.userProfiles = {}
      }
      const previous = getRecordValue(next.userProfiles, qq)?.nickname ?? ''
      setRecordValue(next.userProfiles, qq, { nickname })
      const action = previous
        ? `修改昵称：${previous} -> ${nickname}`
        : `设置昵称：${nickname}`
      const timestamp = Date.now()
      next.logs.push({
        id: `${timestamp}-global-${next.logs.length + 1}`,
        teamId: '',
        teamName: '',
        timestamp,
        actorQq: qq,
        action,
      })
      return next
    }

    case 'updateTeamSubsidyTypes': {
      const team = getTeamOrThrow(next, mutation.teamId)
      const subsidyTypes = normalizeSubsidyTypes(mutation.subsidyTypes)
      team.subsidyTypes = subsidyTypes
      if (team.memberSubsidies) {
        const validIds = new Set(subsidyTypes.map(t => t.id))
        const cleaned: Record<string, MemberSubsidySelection[]> = {}
        for (const [qq, selections] of Object.entries(team.memberSubsidies)) {
          if (!Array.isArray(selections)) continue
          const valid = selections.filter(s => isPlainObject(s) && validIds.has(toText(s.typeId)))
          if (valid.length > 0) {
            setRecordValue(cleaned, qq, normalizeMemberSubsidySelections(valid))
          }
        }
        team.memberSubsidies = cleaned
      }
      return next
    }

    case 'registerMemberSubsidies': {
      const team = getSubsidyTeamOrThrow(next, mutation)
      const hasScopedWeekStart = typeof mutation.weekStart === 'string' && mutation.weekStart.length > 0
      const weekStart = normalizeWeekStart(mutation.weekStart)
      if (hasScopedWeekStart && !weekStart) {
        return next
      }
      if (!team.memberSubsidies) {
        team.memberSubsidies = {}
      }
      const memberQq = toText(mutation.qq)
      const existing = normalizeMemberSubsidySelections(getRecordValue(team.memberSubsidies, memberQq) ?? [])
      const normalizedSelections = normalizeMemberSubsidySelections(mutation.selections)
      if (weekStart) {
        const nextSelections = [
          ...existing.filter(selection => selection.weekStart && selection.weekStart !== weekStart),
          ...normalizedSelections.map(selection => ({ ...selection, weekStart })),
        ]
        setRecordValue(team.memberSubsidies, memberQq, nextSelections)
      } else {
        setRecordValue(team.memberSubsidies, memberQq, normalizedSelections)
      }
      appendLog(next, team, memberQq, '登记补贴')
      return next
    }
  }
}
