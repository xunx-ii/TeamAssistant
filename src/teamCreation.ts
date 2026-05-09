import type { SubsidyType, Team } from './types'
import { createEmptySlots, generateId } from './types'
import { applyMutation, type Snapshot } from './dataStore'
import { normalizeTeamName } from './teamName'
import { normalizeTextInput, TEXT_INPUT_LIMITS } from './textInput'
import { getNextWeekStartKey, getWeekStartKey, getWeekStartKeyFromDateKey } from './week'

export type CreateTeamWeekMode = 'thisWeek' | 'nextWeek' | 'custom'

export interface CreateTeamGuideValues {
  name: string
  weekMode: CreateTeamWeekMode
  customDate: string
  importSubsidyPresets: boolean
  quickReserve: boolean
  reserveT: number
  reserveHealer: number
  reserveBoss: number
}

export const DEFAULT_INITIAL_RESERVE_COUNTS = {
  reserveT: 2,
  reserveHealer: 2,
  reserveBoss: 0,
} as const

export function normalizeCreateTeamReserveCount(value: unknown) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return 0
  return Math.min(25, Math.max(0, Math.trunc(number)))
}

export function cloneSubsidyTypes(subsidyTypes: SubsidyType[]) {
  return subsidyTypes.map(type => ({
    ...type,
    levels: type.levels.map(level => ({ ...level })),
  }))
}

export function resolveCreateTeamWeekStart(values: Pick<CreateTeamGuideValues, 'weekMode' | 'customDate'>, now: Date | number = new Date()) {
  if (values.weekMode === 'nextWeek') return getNextWeekStartKey(now)
  if (values.weekMode === 'custom') {
    return getWeekStartKeyFromDateKey(values.customDate, getWeekStartKey(now))
  }
  return getWeekStartKey(now)
}

export function createDefaultTeam(name = '默认团队', options: { weekStart?: string; subsidyTypes?: SubsidyType[] } = {}): Team {
  const textName = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
  const team: Team = {
    id: generateId(),
    name: normalizeTeamName(textName, '默认团队'),
    note: '',
    config: { reservedSlots: [], locked: false },
    slots: createEmptySlots(),
  }
  if (options.weekStart) team.weekStart = options.weekStart
  if (options.subsidyTypes?.length) team.subsidyTypes = cloneSubsidyTypes(options.subsidyTypes)
  return team
}

export function createTeamFromGuide(values: CreateTeamGuideValues, subsidyPresets: SubsidyType[], now: Date | number = new Date()): Team {
  const team = createDefaultTeam(values.name, {
    weekStart: resolveCreateTeamWeekStart(values, now),
    subsidyTypes: values.importSubsidyPresets ? subsidyPresets : undefined,
  })

  if (!values.quickReserve) return team

  let snapshot: Snapshot = {
    teams: [team],
    cancellations: [],
    archivedTeams: [],
    logs: [],
  }
  const reserveMutations = [
    { reserveType: 'T' as const, count: normalizeCreateTeamReserveCount(values.reserveT) },
    { reserveType: '治疗' as const, count: normalizeCreateTeamReserveCount(values.reserveHealer) },
    { reserveType: 'boss' as const, count: normalizeCreateTeamReserveCount(values.reserveBoss) },
  ]

  for (const reserve of reserveMutations) {
    if (reserve.count <= 0) continue
    snapshot = applyMutation(snapshot, {
      type: 'quickReserve',
      teamId: team.id,
      reserveType: reserve.reserveType,
      count: reserve.count,
    })
  }

  return snapshot.teams[0] ?? team
}
