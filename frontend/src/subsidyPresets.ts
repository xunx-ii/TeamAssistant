import { fetchSubsidyPresets, pushSubsidyPresets } from './api'
import type { SubsidyType } from './types'

const STORAGE_KEY = 'team_subsidy_presets_v1'

const DEFAULT_PRESETS: SubsidyType[] = [
  {
    id: 'preset-damage',
    name: '伤害补贴',
    levels: [
      { name: '第一', gold: 8000 },
      { name: '第二', gold: 5000 },
      { name: '第三', gold: 3000 },
    ],
  },
  {
    id: 'preset-heal',
    name: '治疗补贴',
    levels: [
      { name: '第一', gold: 5000 },
      { name: '第二', gold: 3000 },
    ],
  },
  {
    id: 'preset-tank',
    name: 'T补贴',
    levels: [
      { name: '第一', gold: 5000 },
      { name: '第二', gold: 3000 },
    ],
  },
]

export function loadSubsidyPresets(): SubsidyType[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore invalid preset storage */ }
  return DEFAULT_PRESETS.map(preset => ({
    ...preset,
    levels: preset.levels.map(level => ({ ...level })),
  }))
}

export function saveSubsidyPresets(presets: SubsidyType[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}


export async function syncSubsidyPresetsFromServer(): Promise<SubsidyType[] | null> {
  const presets = await fetchSubsidyPresets()
  if (!presets) return null
  saveSubsidyPresets(presets)
  return presets
}

export async function saveSubsidyPresetsRemote(presets: SubsidyType[], actorQq?: string | null): Promise<boolean> {
  const saved = await pushSubsidyPresets(presets, actorQq)
  if (saved) saveSubsidyPresets(presets)
  return saved
}
