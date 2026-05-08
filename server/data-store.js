function cloneData(data) {
  return structuredClone(normalizeData(data))
}

export function normalizeData(data) {
  return {
    teams: Array.isArray(data?.teams) ? data.teams : [],
    cancellations: Array.isArray(data?.cancellations) ? data.cancellations : [],
    archivedTeams: Array.isArray(data?.archivedTeams) ? data.archivedTeams : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toText(value, fallback = '') {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  return String(value)
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function setRecordValue(record, key, value) {
  Object.defineProperty(record, toText(key), {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function normalizeMember(member) {
  if (!isPlainObject(member)) {
    throw new Error('Invalid member')
  }
  const normalized = {
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

function normalizeSubsidyTypes(subsidyTypes) {
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

function normalizeMemberSubsidySelections(selections) {
  if (!Array.isArray(selections)) {
    throw new Error('Invalid member subsidy selections')
  }
  return selections
    .filter(isPlainObject)
    .map(selection => ({
      typeId: toText(selection.typeId),
      levelName: toText(selection.levelName),
    }))
}

function isValidSnapshotTeam(team) {
  return Boolean(
    isPlainObject(team) &&
    typeof team.id === 'string' &&
    typeof team.name === 'string' &&
    typeof team.note === 'string' &&
    isPlainObject(team.config) &&
    Array.isArray(team.config.reservedSlots) &&
    typeof team.config.locked === 'boolean' &&
    Array.isArray(team.slots),
  )
}

export function validateDataReplacement(currentData, incomingData, { allowReplace = false } = {}) {
  const current = normalizeData(currentData)
  const incoming = normalizeData(incomingData)

  if (incoming.teams.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Refusing to save an empty team snapshot',
    }
  }

  if (!incoming.teams.every(isValidSnapshotTeam)) {
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

function getTeamIndex(teams, teamId) {
  return teams.findIndex(team => team.id === teamId)
}

function getTeamOrThrow(data, teamId) {
  const teamIndex = getTeamIndex(data.teams, teamId)
  if (teamIndex === -1) {
    throw new Error(`Team not found: ${teamId}`)
  }
  return data.teams[teamIndex]
}

function getArchiveOrThrow(data, archiveId) {
  const archive = data.archivedTeams.find(item => item.id === archiveId)
  if (!archive) {
    throw new Error(`Archive not found: ${archiveId}`)
  }
  return archive
}

function getSlotOrThrow(team, slotIndex) {
  const slot = team.slots[slotIndex]
  if (!slot) {
    throw new Error(`Slot not found: ${slotIndex}`)
  }
  return slot
}

function appendLog(data, team, actorQq, action, timestamp = Date.now()) {
  data.logs.push({
    id: `${timestamp}-${team.id}-${data.logs.length + 1}`,
    teamId: team.id,
    teamName: team.name,
    timestamp,
    actorQq: toText(actorQq),
    action: toText(action),
  })
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

function normalizeTeamName(name, fallback = '') {
  const cleaned = Array.from(String(name ?? ''))
    .join('')
    .split('')
    .map(char => {
      const code = char.charCodeAt(0)
      return code <= 31 || code === 127 ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

  const normalized = Array.from(cleaned).slice(0, 40).join('').trim()
  return normalized || fallback
}

function getQuickReserveOrder(reserveType, slotCount) {
  const allSlots = Array.from({ length: slotCount }, (_, index) => index)
  const priorityStart = reserveType === 'T' ? 20 : reserveType === '治疗' ? 15 : null
  if (priorityStart === null) return allSlots

  const priority = Array.from({ length: 5 }, (_, offset) => priorityStart + offset)
    .filter(index => index < slotCount)
  const prioritySet = new Set(priority)
  return [...priority, ...allSlots.filter(index => !prioritySet.has(index))]
}

function getResetStatus(team, slotIndex) {
  const slot = getSlotOrThrow(team, slotIndex)
  if (slot.fixedRole || slot.fixedMartialArtIndex !== null) {
    return 'fixed'
  }
  if (team.config.reservedSlots.includes(slotIndex)) {
    return 'reserved'
  }
  return 'empty'
}

export function validateExpectedSlotMember(data, teamId, slotIndex, expectedMemberQq) {
  const team = getTeamOrThrow(normalizeData(data), teamId)
  const slot = getSlotOrThrow(team, slotIndex)
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

export function validateSlotMutationLock({
  slotLocks,
  teamLocks,
  teamId,
  slotIndex,
  qq,
  lockTimestamp,
  lockTimeout,
  now = Date.now(),
}) {
  if (!teamId || slotIndex == null || !qq || !lockTimestamp) {
    return { ok: false, reason: 'missingFields' }
  }

  const teamLockTime = teamLocks.get(teamId)
  if (teamLockTime && teamLockTime > lockTimestamp) {
    return { ok: false, reason: 'teamLocked', lockedAt: teamLockTime }
  }

  const key = `${teamId}:${slotIndex}`
  const existing = slotLocks.get(key)
  if (!existing || existing.qq !== qq) {
    return { ok: false, reason: 'expired' }
  }

  if (now - existing.timestamp > lockTimeout) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true }
}

export function applyMutation(currentData, mutation) {
  const data = cloneData(currentData)

  switch (mutation.type) {
    case 'createTeam': {
      data.teams.push({
        ...mutation.team,
        name: normalizeTeamName(mutation.team?.name, '默认团队'),
      })
      return data
    }

    case 'deleteTeam': {
      data.teams = data.teams.filter(team => team.id !== mutation.teamId)
      if (data.teams.length === 0 && mutation.fallbackTeam) {
        data.teams.push(mutation.fallbackTeam)
      }
      return data
    }

    case 'archiveTeam': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const archivedAt = mutation.archivedAt ?? Date.now()
      data.archivedTeams.push({
        id: `${team.id}-${archivedAt}`,
        team,
        archivedAt,
        archivedBy: mutation.archivedBy,
      })
      appendLog(data, team, mutation.archivedBy, '归档表格', archivedAt)
      data.teams = data.teams.filter(item => item.id !== mutation.teamId)
      if (data.teams.length === 0 && mutation.fallbackTeam) {
        data.teams.push(mutation.fallbackTeam)
      }
      return data
    }

    case 'restoreArchivedTeam': {
      const archive = getArchiveOrThrow(data, mutation.archiveId)
      const restoredAt = mutation.restoredAt ?? Date.now()
      data.teams.push(archive.team)
      data.archivedTeams = data.archivedTeams.filter(item => item.id !== mutation.archiveId)
      appendLog(data, archive.team, mutation.actorQq, '恢复表格', restoredAt)
      return data
    }

    case 'renameTeam': {
      const team = getTeamOrThrow(data, mutation.teamId)
      team.name = normalizeTeamName(mutation.name, team.name)
      return data
    }

    case 'updateTeamNote': {
      const team = getTeamOrThrow(data, mutation.teamId)
      team.note = toText(mutation.note)
      return data
    }

    case 'reorderTeams': {
      const teamMap = new Map(data.teams.map(team => [team.id, team]))
      const ordered = mutation.ids
        .map(id => teamMap.get(id))
        .filter(Boolean)
      const orderedIds = new Set(ordered.map(team => team.id))
      const remainder = data.teams.filter(team => !orderedIds.has(team.id))
      data.teams = [...ordered, ...remainder]
      return data
    }

    case 'toggleTeamConfigLock': {
      const team = getTeamOrThrow(data, mutation.teamId)
      team.config.locked = Boolean(mutation.locked)
      return data
    }

    case 'setTeamLockState': {
      const team = getTeamOrThrow(data, mutation.teamId)
      team.config.locked = Boolean(mutation.locked)
      return data
    }

    case 'setSlotRole': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const slot = getSlotOrThrow(team, mutation.slotIndex)

      if (mutation.role === 'boss') {
        team.config.reservedSlots = uniqueSorted([...team.config.reservedSlots, mutation.slotIndex])
        slot.status = 'reserved'
        slot.member = null
        slot.fixedRole = null
        slot.fixedMartialArtIndex = null
        return data
      }

      team.config.reservedSlots = team.config.reservedSlots.filter(index => index !== mutation.slotIndex)

      if (mutation.role === null) {
        slot.status = 'empty'
        slot.member = null
        slot.fixedRole = null
        slot.fixedMartialArtIndex = null
        return data
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
        appendLog(data, team, mutation.actorQq ?? mutation.assignQQ, `指定 #${mutation.slotIndex + 1} 报名：${mutation.assignQQ}`)
        return data
      }

      slot.status = 'fixed'
      slot.member = null
      slot.fixedRole = mutation.role
      slot.fixedMartialArtIndex = mutation.martialArtIndex
      return data
    }

    case 'quickReserve': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const slots = team.slots
      let reserved = [...team.config.reservedSlots]
      const reserveOrder = getQuickReserveOrder(mutation.reserveType, slots.length)
      const current = mutation.reserveType === 'boss'
        ? reserved.length
        : slots.filter(slot => slot.status === 'fixed' && slot.fixedRole === mutation.reserveType).length

      if (mutation.reserveType === 'boss') {
        if (mutation.count < current) {
          const toRemove = reserved.slice(mutation.count)
          reserved = reserved.filter(index => !toRemove.includes(index))
          for (const slotIndex of toRemove) {
            const slot = getSlotOrThrow(team, slotIndex)
            slot.status = 'empty'
            slot.member = null
            slot.fixedRole = null
            slot.fixedMartialArtIndex = null
          }
        } else {
          let need = mutation.count - current
          for (let index = 0; index < slots.length && need > 0; index += 1) {
            const slot = slots[index]
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
        const toReset = slots
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
          const slot = slots[index]
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
      return data
    }

    case 'signupSlot': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const slot = getSlotOrThrow(team, mutation.slotIndex)
      const isUpdate = Boolean(slot.member)
      const member = normalizeMember(mutation.member)
      slot.status = 'occupied'
      slot.member = member
      const action = isUpdate
        ? `修改 #${mutation.slotIndex + 1} 报名：${member.characterId}`
        : `报名 #${mutation.slotIndex + 1}：${member.characterId}`
      appendLog(data, team, mutation.actorQq ?? member.qq, action)
      return data
    }

    case 'cancelSlot': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const slot = getSlotOrThrow(team, mutation.slotIndex)
      if (!slot.member) {
        return data
      }
      data.cancellations.push({
        qq: slot.member.qq,
        reason: toText(mutation.reason),
        cancelledBy: toText(mutation.cancelledBy),
        teamId: team.id,
        teamName: team.name,
        slotIndex: mutation.slotIndex,
        timestamp: mutation.timestamp ?? Date.now(),
      })
      appendLog(data, team, mutation.cancelledBy, `取消 #${mutation.slotIndex + 1} 报名：${slot.member.characterId}`)
      slot.status = getResetStatus(team, mutation.slotIndex)
      slot.member = null
      return data
    }

    case 'leaveSlot': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const slot = getSlotOrThrow(team, mutation.slotIndex)
      const characterId = slot.member?.characterId ?? ''
      appendLog(data, team, mutation.actorQq ?? slot.member?.qq ?? '', `退出 #${mutation.slotIndex + 1} 报名${characterId ? `：${characterId}` : ''}`)
      slot.status = getResetStatus(team, mutation.slotIndex)
      slot.member = null
      return data
    }

    case 'dismissCancellation': {
      data.cancellations = data.cancellations.filter(item => (
        item.qq !== mutation.qq || item.timestamp !== mutation.timestamp
      ))
      return data
    }

    case 'updateTeamSubsidyTypes': {
      const team = getTeamOrThrow(data, mutation.teamId)
      const subsidyTypes = normalizeSubsidyTypes(mutation.subsidyTypes)
      team.subsidyTypes = subsidyTypes
      if (team.memberSubsidies) {
        const validIds = new Set(subsidyTypes.map(t => t.id))
        const cleaned = {}
        for (const [qq, selections] of Object.entries(team.memberSubsidies)) {
          if (!Array.isArray(selections)) continue
          const valid = selections.filter(s => isPlainObject(s) && validIds.has(toText(s.typeId)))
          if (valid.length > 0) {
            setRecordValue(cleaned, qq, normalizeMemberSubsidySelections(valid))
          }
        }
        team.memberSubsidies = cleaned
      }
      return data
    }

    case 'registerMemberSubsidies': {
      const team = getTeamOrThrow(data, mutation.teamId)
      if (!team.memberSubsidies) {
        team.memberSubsidies = {}
      }
      const qq = toText(mutation.qq)
      setRecordValue(team.memberSubsidies, qq, normalizeMemberSubsidySelections(mutation.selections))
      appendLog(data, team, qq, '登记补贴')
      return data
    }

    default:
      throw new Error(`Unsupported mutation type: ${mutation.type}`)
  }
}
