import type { Slot, SubsidyType, Team, TeamConfig, TeamTemplate } from './types'
import { TOTAL_SLOTS, generateId } from './types'
import { martialArts } from './data/martialArts'
import { normalizeTeamName } from './teamName'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from './textInput'

const STORAGE_KEY = 'team_templates_v1'
const VALID_ROLES = new Set<NonNullable<Slot['fixedRole']>>(['T', '治疗', 'DPS'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function toText(value: unknown, fallback = '') {
  if (typeof value === 'string') return value
  if (value == null) return fallback
  return String(value)
}

function toSafeInteger(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback
}

function isSlotIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TOTAL_SLOTS
}

function normalizeMartialArtIndex(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < martialArts.length
    ? Number(value)
    : null
}

function normalizeTemplateSlot(
  slot: unknown,
  index: number,
  reservedSlots: ReadonlySet<number>,
): Slot {
  const source = isRecord(slot) ? slot : {}
  const fixedRole = VALID_ROLES.has(toText(source.fixedRole) as NonNullable<Slot['fixedRole']>)
    ? toText(source.fixedRole) as NonNullable<Slot['fixedRole']>
    : null
  const fixedMartialArtIndex = normalizeMartialArtIndex(source.fixedMartialArtIndex)
  const inferredRole = fixedRole ?? (fixedMartialArtIndex === null ? null : martialArts[fixedMartialArtIndex]?.role ?? null)
  const isFixed = inferredRole !== null || fixedMartialArtIndex !== null
  return {
    index,
    status: isFixed ? 'fixed' : reservedSlots.has(index) ? 'reserved' : 'empty',
    member: null,
    fixedRole: inferredRole,
    fixedMartialArtIndex,
  }
}

function normalizeSubsidyTypes(value: unknown): SubsidyType[] | undefined {
  if (!Array.isArray(value)) return undefined
  const types = value.flatMap(item => {
    if (!isRecord(item)) return []
    const id = toText(item.id).trim()
    const name = normalizeTextInput(item.name, { maxLength: TEXT_INPUT_LIMITS.subsidyName })
    const levels = Array.isArray(item.levels)
      ? item.levels.flatMap(level => {
          if (!isRecord(level)) return []
          const levelName = normalizeTextInput(level.name, { maxLength: TEXT_INPUT_LIMITS.subsidyLevelName })
          const gold = Number(level.gold)
          return levelName && Number.isFinite(gold) && gold >= 0
            ? [{ name: levelName, gold: Math.trunc(gold) }]
            : []
        })
      : []
    return id && name && levels.length > 0 ? [{ id, name, levels }] : []
  })
  return types.length > 0 ? types : undefined
}

function normalizeConfig(value: unknown, reservedSlots: number[]): TeamConfig {
  const source = isRecord(value) ? value : {}
  return {
    reservedSlots,
    locked: false,
    onlyTnSignup: source.onlyTnSignup === true,
    uniqueQqSignup: source.uniqueQqSignup === true,
    publicSignup: true,
    publicAtMs: 0,
  }
}

export function normalizeTeamTemplate(value: unknown): TeamTemplate | null {
  if (!isRecord(value)) return null
  const id = toText(value.id).trim()
  const rawName = normalizeTextInput(value.name, { maxLength: TEXT_INPUT_LIMITS.teamTemplateName })
  if (!id || !rawName) return null

  const configSource = isRecord(value.config) ? value.config : {}
  const reserved = new Set<number>()
  if (Array.isArray(configSource.reservedSlots)) {
    for (const slotIndex of configSource.reservedSlots) {
      if (isSlotIndex(slotIndex)) reserved.add(slotIndex)
    }
  }
  const rawSlots = Array.isArray(value.slots) ? value.slots : []
  rawSlots.forEach((slot, index) => {
    if (isSlotIndex(index) && isRecord(slot) && slot.status === 'reserved' && !slot.fixedRole && slot.fixedMartialArtIndex == null) {
      reserved.add(index)
    }
  })
  const reservedSlots = [...reserved].sort((left, right) => left - right)
  const slots = Array.from({ length: TOTAL_SLOTS }, (_, index) => (
    normalizeTemplateSlot(rawSlots[index], index, reserved)
  ))
  const note = sanitizeTextInput(value.note, { maxLength: TEXT_INPUT_LIMITS.note, multiline: true }).trim()
  const subsidyTypes = normalizeSubsidyTypes(value.subsidyTypes)
  const createdAt = toSafeInteger(value.createdAt)
  const updatedAt = Math.max(createdAt, toSafeInteger(value.updatedAt, createdAt))

  return {
    id,
    name: normalizeTeamName(rawName, '开团模板'),
    note,
    config: normalizeConfig(value.config, reservedSlots),
    slots,
    ...(subsidyTypes ? { subsidyTypes } : {}),
    createdAt,
    updatedAt,
    createdBy: toText(value.createdBy),
  }
}

export function normalizeTeamTemplates(value: unknown): TeamTemplate[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeTeamTemplate)
    .filter((template): template is TeamTemplate => template !== null)
}

export function createTeamTemplateFromTeam(
  team: Team,
  name: string,
  createdBy: string,
  now = Date.now(),
): TeamTemplate {
  const templateName = normalizeTeamName(
    normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamTemplateName }),
    team.name,
  )
  const reservedSlots = [...new Set([
    ...team.config.reservedSlots,
    ...team.slots.filter(slot => slot.status === 'reserved').map(slot => slot.index),
  ])]
    .filter(isSlotIndex)
    .sort((left, right) => left - right)
  const reserved = new Set(reservedSlots)
  const slots = team.slots.map((slot, index) => normalizeTemplateSlot(slot, index, reserved))
  const template = normalizeTeamTemplate({
    id: generateId(),
    name: templateName,
    note: team.note,
    config: {
      ...team.config,
      reservedSlots,
    },
    slots,
    subsidyTypes: team.subsidyTypes,
    createdAt: now,
    updatedAt: now,
    createdBy,
  })
  if (!template) throw new Error('无法创建团队模板')
  return template
}

export function formatTeamTemplateSummary(template: TeamTemplate) {
  const fixedCount = template.slots.filter(slot => slot.status === 'fixed').length
  const reservedCount = template.slots.filter(slot => slot.status === 'reserved').length
  const subsidyCount = template.subsidyTypes?.length ?? 0
  return `预留 ${reservedCount} · 固定 ${fixedCount} · 补贴 ${subsidyCount}`
}

export type TeamTemplateDeleteResult = 'deleted' | 'cancelled' | 'failed'

export function loadTeamTemplates(): TeamTemplate[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeTeamTemplates(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveTeamTemplates(templates: TeamTemplate[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTeamTemplates(templates)))
}
