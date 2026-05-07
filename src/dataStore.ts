import type { ArchivedTeam, Cancellation, Member, OperationLog, Team } from './types'

export interface Snapshot {
  teams: Team[]
  cancellations: Cancellation[]
  archivedTeams: ArchivedTeam[]
  logs: OperationLog[]
}

export type Mutation =
  | { type: 'createTeam'; team: Team }
  | { type: 'deleteTeam'; teamId: string; fallbackTeam?: Team }
  | { type: 'archiveTeam'; teamId: string; archivedBy: string; archivedAt?: number; fallbackTeam?: Team }
  | { type: 'restoreArchivedTeam'; archiveId: string; actorQq: string; restoredAt?: number }
  | { type: 'renameTeam'; teamId: string; name: string }
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

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  const cloned = structuredClone(snapshot) as Partial<Snapshot>
  return {
    teams: Array.isArray(cloned.teams) ? cloned.teams : [],
    cancellations: Array.isArray(cloned.cancellations) ? cloned.cancellations : [],
    archivedTeams: Array.isArray(cloned.archivedTeams) ? cloned.archivedTeams : [],
    logs: Array.isArray(cloned.logs) ? cloned.logs : [],
  }
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

function appendLog(snapshot: Snapshot, team: Team, actorQq: string, action: string, timestamp = Date.now()) {
  snapshot.logs.push({
    id: `${timestamp}-${team.id}-${snapshot.logs.length + 1}`,
    teamId: team.id,
    teamName: team.name,
    timestamp,
    actorQq,
    action,
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

export function applyMutation(snapshot: Snapshot, mutation: Mutation): Snapshot {
  const next = cloneSnapshot(snapshot)

  switch (mutation.type) {
    case 'createTeam':
      next.teams.push(mutation.team)
      return next

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
      team.name = mutation.name
      return next
    }

    case 'updateTeamNote': {
      const team = getTeamOrThrow(next, mutation.teamId)
      team.note = mutation.note
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
        const toReset = team.slots
          .filter(slot => slot.status === 'fixed' && slot.fixedRole === mutation.reserveType)
          .slice(0, current - mutation.count)
        for (const slot of toReset) {
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
      slot.status = 'occupied'
      slot.member = mutation.member
      const action = isUpdate
        ? `修改 #${mutation.slotIndex + 1} 报名：${mutation.member.characterId}`
        : `报名 #${mutation.slotIndex + 1}：${mutation.member.characterId}`
      appendLog(next, team, mutation.actorQq ?? mutation.member.qq, action)
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
        reason: mutation.reason,
        cancelledBy: mutation.cancelledBy,
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
  }
}
