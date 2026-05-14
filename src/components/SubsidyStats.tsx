import { useMemo, useState } from 'react'
import type { SubsidyTarget, UserProfiles } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Button } from './ui/button'
import { formatWeekRange } from '../week'
import { getSubsidyWeekOptions, resolveSubsidySelectionWeekStart } from '../subsidy'

const PAGE_SIZE = 8

interface Props {
  open: boolean
  targets: SubsidyTarget[]
  userProfiles: UserProfiles
  onClose: () => void
}

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

export function SubsidyStats({ open, targets, userProfiles, onClose }: Props) {
  const [selectedWeekStart, setSelectedWeekStart] = useState('')
  const [page, setPage] = useState(0)
  const availableWeeks = useMemo(() => getSubsidyWeekOptions(targets), [targets])
  const resolvedWeekStart = availableWeeks.includes(selectedWeekStart)
    ? selectedWeekStart
    : (availableWeeks[0] ?? '')

  const rows = useMemo<StatRow[]>(() => createSubsidyStatRows(targets, resolvedWeekStart), [resolvedWeekStart, targets])
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const resolvedPage = Math.min(page, pageCount - 1)
  const pagedRows = rows.slice(resolvedPage * PAGE_SIZE, (resolvedPage + 1) * PAGE_SIZE)
  const handleWeekChange = (weekStart: string) => {
    setSelectedWeekStart(weekStart)
    setPage(0)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">补贴统计</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={resolvedWeekStart} onValueChange={handleWeekChange}>
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
                {pagedRows.map(row => (
                  <tr key={row.qq} className="border-b border-border last:border-0">
                    <td className="py-2 text-foreground">
                      {(() => {
                        const [rowQq, rowNickname] = getSubsidyStatUserLines(row, userProfiles)
                        return (
                          <>
                            <div className="font-mono">{rowQq}</div>
                            <div className="mt-0.5 break-words text-muted-foreground">{rowNickname}</div>
                          </>
                        )
                      })()}
                    </td>
                    <td className="py-2 text-foreground">
                      <div className="space-y-1">
                        {row.details.map((detail, index) => (
                          <div key={`${row.qq}-${index}`} className="break-words leading-5">
                            {detail}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 text-right font-bold text-amber-600">{row.gold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setPage(Math.max(0, resolvedPage - 1))}
                disabled={resolvedPage === 0}
              >
                上一页
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">{resolvedPage + 1}/{pageCount}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setPage(Math.min(pageCount - 1, resolvedPage + 1))}
                disabled={resolvedPage >= pageCount - 1}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
