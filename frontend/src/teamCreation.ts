import type { SubsidyType, Team } from './types'
import { createEmptySlots, generateId } from './types'
import { applyMutation, type Snapshot } from './dataStore'
import { normalizeTeamName } from './teamName'
import { normalizeTextInput, TEXT_INPUT_LIMITS } from './textInput'
import { getWeekStartKey, normalizeWeekStartKey } from './week'
import { martialArts } from './data/martialArts'
import { normalizeTeamPublication } from './teamPublication'

export interface CreateTeamGuideValues {
  name: string
  count?: number
  weekStart: string
  subsidyPresetIds: string[]
  onlyTnSignup: boolean
  uniqueQqSignup: boolean
  publicSignup?: boolean
  publicAtMs?: number
  quickReserve: boolean
  reserveT: number
  reserveHealer: number
  reserveBoss: number
  reserveDps?: Array<{
    martialArtIndex: number
    count: number
  }>
}

export const DEFAULT_INITIAL_RESERVE_COUNTS = {
  reserveT: 2,
  reserveHealer: 2,
  reserveBoss: 0,
} as const

export const MAX_BATCH_TEAM_COUNT = 50

export function normalizeCreateTeamReserveCount(value: unknown) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return 0
  return Math.min(25, Math.max(0, Math.trunc(number)))
}

export function normalizeTeamBatchCount(value: unknown) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(number)) return 1
  return Math.min(MAX_BATCH_TEAM_COUNT, Math.max(1, Math.trunc(number)))
}

export function cloneSubsidyTypes(subsidyTypes: SubsidyType[]) {
  return subsidyTypes.map(type => ({
    ...type,
    levels: type.levels.map(level => ({ ...level })),
  }))
}

function createBatchTeamName(name: string, index: number, count: number) {
  const normalizedName = normalizeTeamName(
    normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName }),
    '默认团队',
  )
  if (count === 1) return normalizedName

  const suffix = ` ${index + 1}`
  const maxBaseLength = Math.max(1, TEXT_INPUT_LIMITS.teamName - Array.from(suffix).length)
  const base = Array.from(normalizedName).slice(0, maxBaseLength).join('')
  return normalizeTeamName(`${base}${suffix}`, `团队 ${index + 1}`)
}

export function createDefaultTeam(name = '默认团队', options: { weekStart?: string; subsidyTypes?: SubsidyType[] } = {}): Team {
  const textName = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
  const team: Team = {
    id: generateId(),
    name: normalizeTeamName(textName, '默认团队'),
    note: '',
    config: { reservedSlots: [], locked: false, onlyTnSignup: false, uniqueQqSignup: false, publicSignup: true, publicAtMs: 0 },
    slots: createEmptySlots(),
  }
  const weekStart = normalizeWeekStartKey(options.weekStart)
  if (weekStart) team.weekStart = weekStart
  if (options.subsidyTypes?.length) team.subsidyTypes = cloneSubsidyTypes(options.subsidyTypes)
  return team
}

export function createTeamFromGuide(values: CreateTeamGuideValues, subsidyPresets: SubsidyType[], now: Date | number = new Date()): Team {
  const selectedPresetIds = new Set(values.subsidyPresetIds)
  const selectedSubsidyPresets = subsidyPresets.filter(preset => selectedPresetIds.has(preset.id))
  const team = createDefaultTeam(values.name, {
    weekStart: normalizeWeekStartKey(values.weekStart, getWeekStartKey(now)),
    subsidyTypes: selectedSubsidyPresets,
  })
  team.config.onlyTnSignup = values.onlyTnSignup === true
  team.config.uniqueQqSignup = values.uniqueQqSignup === true
  Object.assign(team.config, normalizeTeamPublication(values))

  if (!values.quickReserve) return team

  let snapshot: Snapshot = {
    teams: [team],
    cancellations: [],
    archivedTeams: [],
    logs: [],
    userProfiles: {},
  }
  const reserveMutations: Array<{
    reserveType: 'T' | '治疗' | 'DPS' | 'boss'
    count: number
    martialArtIndex: number | null
  }> = [
    { reserveType: 'T' as const, count: normalizeCreateTeamReserveCount(values.reserveT), martialArtIndex: null },
    { reserveType: '治疗' as const, count: normalizeCreateTeamReserveCount(values.reserveHealer), martialArtIndex: null },
    { reserveType: 'boss' as const, count: normalizeCreateTeamReserveCount(values.reserveBoss), martialArtIndex: null },
  ]
  if (!team.config.onlyTnSignup) {
    const dpsCounts = new Map<number, number>()
    for (const reserve of values.reserveDps ?? []) {
      if (!Number.isInteger(reserve.martialArtIndex) || martialArts[reserve.martialArtIndex]?.role !== 'DPS') continue
      const count = normalizeCreateTeamReserveCount(reserve.count)
      if (count > 0) dpsCounts.set(reserve.martialArtIndex, count)
    }
    for (const [martialArtIndex, count] of dpsCounts) {
      reserveMutations.push({
        reserveType: 'DPS',
        count,
        martialArtIndex,
      })
    }
  }

  for (const reserve of reserveMutations) {
    if (reserve.count <= 0) continue
    snapshot = applyMutation(snapshot, {
      type: 'quickReserve',
      teamId: team.id,
      reserveType: reserve.reserveType,
      count: reserve.count,
      martialArtIndex: reserve.martialArtIndex,
    })
  }

  return snapshot.teams[0] ?? team
}

export function createTeamsFromGuide(values: CreateTeamGuideValues, subsidyPresets: SubsidyType[], now: Date | number = new Date()): Team[] {
  const count = normalizeTeamBatchCount(values.count)
  return Array.from({ length: count }, (_, index) => createTeamFromGuide({
    ...values,
    count: 1,
    name: createBatchTeamName(values.name, index, count),
  }, subsidyPresets, now))
}

export function createTeamCopies(source: Team, name: string, countValue: unknown): Team[] {
  const count = normalizeTeamBatchCount(countValue)
  const reservedSlots = [...source.config.reservedSlots]

  return Array.from({ length: count }, (_, copyIndex) => {
    const team: Team = {
      id: generateId(),
      name: createBatchTeamName(name, copyIndex, count),
      note: source.note,
      config: {
        ...source.config,
        reservedSlots: [...reservedSlots],
        locked: false,
      },
      slots: source.slots.map(slot => {
        const isFixed = slot.fixedRole !== null || slot.fixedMartialArtIndex !== null
        const isReserved = reservedSlots.includes(slot.index)
        return {
          index: slot.index,
          status: isFixed ? 'fixed' : isReserved ? 'reserved' : 'empty',
          member: null,
          fixedRole: slot.fixedRole,
          fixedMartialArtIndex: slot.fixedMartialArtIndex,
        }
      }),
    }
    const weekStart = normalizeWeekStartKey(source.weekStart)
    if (weekStart) team.weekStart = weekStart
    if (source.subsidyTypes?.length) team.subsidyTypes = cloneSubsidyTypes(source.subsidyTypes)
    return team
  })
}
