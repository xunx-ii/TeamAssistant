import type { ArchivedTeam, Cancellation, Member, OperationLog, Slot, SubsidyType, Team, TeamConfig } from './types'
import { createEmptySlots, TOTAL_SLOTS } from './types'

interface HydratableSnapshot {
  teams: Team[]
  cancellations: Cancellation[]
  archivedTeams: ArchivedTeam[]
  logs: OperationLog[]
}

const VALID_SLOT_STATUSES = new Set(['empty', 'occupied', 'reserved', 'fixed'])
const VALID_ROLES = new Set(['T', '治疗', 'DPS'])
const WEEK_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  return String(value)
}

function toFiniteNumber(value: unknown, fallback = 0) {
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

function isSlotIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TOTAL_SLOTS
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right)
}

function normalizeMember(member: unknown): Member | null {
  if (!isRecord(member)) return null
  return {
    qq: toText(member.qq),
    martialArtIndex: toText(member.martialArtIndex),
    gearScore: toText(member.gearScore),
    characterId: toText(member.characterId),
    note: toText(member.note),
    ...('hasOrangeWeapon' in member ? { hasOrangeWeapon: Boolean(member.hasOrangeWeapon) } : {}),
  }
}

function normalizeConfig(config: unknown): TeamConfig {
  const source = isRecord(config) ? config : {}
  const reservedSlots = Array.isArray(source.reservedSlots)
    ? uniqueSorted(source.reservedSlots.filter(isSlotIndex))
    : []
  return {
    reservedSlots,
    locked: typeof source.locked === 'boolean' ? source.locked : false,
  }
}

function normalizeSlot(slot: unknown, index: number, reservedSlots: number[]): Slot {
  const emptySlot = createEmptySlots()[index]
  if (!isRecord(slot)) {
    return reservedSlots.includes(index) ? { ...emptySlot, status: 'reserved' } : emptySlot
  }

  const status = VALID_SLOT_STATUSES.has(toText(slot.status)) ? slot.status as Slot['status'] : 'empty'
  const member = normalizeMember(slot.member)
  const fixedRole = VALID_ROLES.has(toText(slot.fixedRole)) ? slot.fixedRole as Slot['fixedRole'] : null
  const fixedMartialArtIndex = Number.isInteger(slot.fixedMartialArtIndex) ? Number(slot.fixedMartialArtIndex) : null

  if (status === 'occupied' && member) {
    return {
      index,
      status: 'occupied',
      member,
      fixedRole,
      fixedMartialArtIndex,
    }
  }

  if (status === 'fixed' && (fixedRole || fixedMartialArtIndex !== null)) {
    return {
      index,
      status: 'fixed',
      member: null,
      fixedRole,
      fixedMartialArtIndex,
    }
  }

  if (reservedSlots.includes(index) || status === 'reserved') {
    return {
      index,
      status: 'reserved',
      member: null,
      fixedRole: null,
      fixedMartialArtIndex: null,
    }
  }

  return emptySlot
}

function normalizeSubsidyTypes(subsidyTypes: unknown): SubsidyType[] | undefined {
  if (!Array.isArray(subsidyTypes)) return undefined
  return subsidyTypes
    .filter(isRecord)
    .map(type => ({
      id: toText(type.id),
      name: toText(type.name),
      levels: Array.isArray(type.levels)
        ? type.levels
            .filter(isRecord)
            .map(level => ({
              name: toText(level.name),
              gold: Math.max(0, toFiniteNumber(level.gold)),
            }))
        : [],
    }))
}

function normalizeWeekStart(value: unknown) {
  return typeof value === 'string' && WEEK_START_PATTERN.test(value) ? value : undefined
}

function normalizeMemberSubsidies(memberSubsidies: unknown) {
  if (!isRecord(memberSubsidies)) return undefined
  const normalized: NonNullable<Team['memberSubsidies']> = {}
  for (const [qq, selections] of Object.entries(memberSubsidies)) {
    if (!Array.isArray(selections)) continue
    setRecordValue(normalized, qq, selections
      .filter(isRecord)
      .map(selection => {
        const normalizedSelection: NonNullable<Team['memberSubsidies']>[string][number] = {
          typeId: toText(selection.typeId),
          levelName: toText(selection.levelName),
        }
        if (typeof selection.weekStart === 'string') {
          normalizedSelection.weekStart = selection.weekStart
        }
        return normalizedSelection
      }))
  }
  return normalized
}

function normalizeTeam(team: unknown): Team | null {
  if (!isRecord(team) || typeof team.id !== 'string') return null
  const config = normalizeConfig(team.config)
  const sourceSlots = Array.isArray(team.slots) ? team.slots : []
  config.reservedSlots = uniqueSorted([
    ...config.reservedSlots,
    ...sourceSlots.flatMap((slot, index) => (
      isSlotIndex(index) && isRecord(slot) && slot.status === 'reserved' ? [index] : []
    )),
  ])
  const normalized: Team = {
    id: team.id,
    name: toText(team.name, '默认团队') || '默认团队',
    note: toText(team.note),
    config,
    slots: Array.from(
      { length: TOTAL_SLOTS },
      (_, index) => normalizeSlot(sourceSlots[index], index, config.reservedSlots),
    ),
  }
  const subsidyTypes = normalizeSubsidyTypes(team.subsidyTypes)
  const memberSubsidies = normalizeMemberSubsidies(team.memberSubsidies)
  const weekStart = normalizeWeekStart(team.weekStart)
  if (weekStart) normalized.weekStart = weekStart
  if (subsidyTypes) normalized.subsidyTypes = subsidyTypes
  if (memberSubsidies) normalized.memberSubsidies = memberSubsidies
  return normalized
}

function normalizeArchivedTeam(archive: unknown): ArchivedTeam | null {
  if (!isRecord(archive) || typeof archive.id !== 'string') return null
  const team = normalizeTeam(archive.team)
  if (!team) return null
  return {
    id: archive.id,
    team,
    archivedAt: toFiniteNumber(archive.archivedAt),
    archivedBy: toText(archive.archivedBy),
  }
}

function normalizeCancellation(cancellation: unknown): Cancellation | null {
  if (!isRecord(cancellation)) return null
  return {
    qq: toText(cancellation.qq),
    reason: toText(cancellation.reason),
    cancelledBy: toText(cancellation.cancelledBy),
    teamId: toText(cancellation.teamId),
    teamName: toText(cancellation.teamName),
    slotIndex: Number.isInteger(cancellation.slotIndex) ? Number(cancellation.slotIndex) : 0,
    timestamp: toFiniteNumber(cancellation.timestamp),
  }
}

function normalizeLog(log: unknown): OperationLog | null {
  if (!isRecord(log)) return null
  return {
    id: toText(log.id),
    teamId: toText(log.teamId),
    teamName: toText(log.teamName),
    timestamp: toFiniteNumber(log.timestamp),
    actorQq: toText(log.actorQq),
    action: toText(log.action),
  }
}

export function normalizeHydratableData(data: unknown): HydratableSnapshot {
  const source = isRecord(data) ? data : {}
  return {
    teams: Array.isArray(source.teams) ? source.teams.map(normalizeTeam).filter((team): team is Team => Boolean(team)) : [],
    cancellations: Array.isArray(source.cancellations)
      ? source.cancellations.map(normalizeCancellation).filter((item): item is Cancellation => Boolean(item))
      : [],
    archivedTeams: Array.isArray(source.archivedTeams)
      ? source.archivedTeams.map(normalizeArchivedTeam).filter((item): item is ArchivedTeam => Boolean(item))
      : [],
    logs: Array.isArray(source.logs) ? source.logs.map(normalizeLog).filter((log): log is OperationLog => Boolean(log)) : [],
  }
}

export function normalizeHydratableTeams(teams: unknown): Team[] {
  return normalizeHydratableData(Array.isArray(teams) ? { teams } : teams).teams
}
