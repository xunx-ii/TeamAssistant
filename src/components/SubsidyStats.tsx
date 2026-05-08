import { useMemo, useState } from 'react'
import type { SubsidyTarget } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { formatWeekRange } from '../week'
import { getSubsidyWeekOptions, resolveSubsidySelectionWeekStart } from '../subsidy'

interface Props {
  open: boolean
  targets: SubsidyTarget[]
  onClose: () => void
}

interface StatRow {
  qq: string
  details: string
  gold: number
}

export function SubsidyStats({ open, targets, onClose }: Props) {
  const [selectedWeekStart, setSelectedWeekStart] = useState('')
  const availableWeeks = useMemo(() => getSubsidyWeekOptions(targets), [targets])
  const resolvedWeekStart = availableWeeks.includes(selectedWeekStart)
    ? selectedWeekStart
    : (availableWeeks[0] ?? '')

  const rows = useMemo<StatRow[]>(() => {
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
          const current = result.get(qq) ?? { qq, details: '', gold: 0 }
          current.gold += gold
          const detail = `${target.name}：${subsidyType.name}${selection.levelName}(${gold}金)`
          current.details = current.details ? `${current.details} + ${detail}` : detail
          result.set(qq, current)
        }
      }
    }
    return [...result.values()]
      .filter(row => row.gold > 0)
      .sort((a, b) => b.gold - a.gold || a.qq.localeCompare(b.qq))
  }, [resolvedWeekStart, targets])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">补贴统计</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={resolvedWeekStart} onValueChange={setSelectedWeekStart}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="选择周" />
            </SelectTrigger>
            <SelectContent>
              {availableWeeks.map(weekStart => (
                <SelectItem key={weekStart} value={weekStart}>
                  {formatWeekRange(weekStart)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">暂无该周补贴登记记录</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">用户</th>
                  <th className="text-left py-2 font-medium">补贴详情</th>
                  <th className="text-right py-2 font-medium">金币</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.qq} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono text-foreground">{row.qq}</td>
                    <td className="py-2 text-foreground break-words">{row.details}</td>
                    <td className="py-2 text-right font-bold text-amber-600">{row.gold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
