import type { SubsidyTarget, UserProfiles } from './types'
import { resolveSubsidySelectionWeekStart } from './subsidy'

export interface StatRow {
  qq: string
  details: string[]
  gold: number
}

export function createSubsidyStatRows(targets: SubsidyTarget[], resolvedWeekStart: string): StatRow[] {
  if (!resolvedWeekStart) return []
  const result = new Map<string, StatRow>()
  for (const target of targets) {
    const typeMap = new Map(target.subsidyTypes.map(t => [t.id, t]))
    for (const [qq, selections] of Object.entries(target.memberSubsidies)) {
      for (const selection of selections) {
        const selectionWeekStart = resolveSubsidySelectionWeekStart(selection, target.weekStart)
        if (selectionWeekStart !== resolvedWeekStart) continue
        const subsidyType = typeMap.get(selection.typeId)
        if (!subsidyType) continue
        const level = subsidyType.levels.find(item => item.name === selection.levelName)
        if (!level) continue
        const gold = Number(level.gold) || 0
        const current = result.get(qq) ?? { qq, details: [], gold: 0 }
        current.gold += gold
        const detail = `${target.name}：${subsidyType.name}${selection.levelName}(${gold}金)`
        current.details.push(detail)
        result.set(qq, current)
      }
    }
  }
  return [...result.values()]
    .filter(row => row.gold > 0)
    .sort((a, b) => b.gold - a.gold || a.qq.localeCompare(b.qq))
}

export function getSubsidyStatUserLines(row: Pick<StatRow, 'qq'>, userProfiles: UserProfiles): [string, string] {
  return [row.qq, userProfiles[row.qq]?.nickname || '未设置']
}
