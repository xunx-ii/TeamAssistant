import type { SubsidyType } from './types'

export function formatSubsidyPresetPreview(preset: SubsidyType) {
  return preset.levels.map(level => `${level.name}:${level.gold}`).join(', ')
}
