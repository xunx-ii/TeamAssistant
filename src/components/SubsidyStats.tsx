import { useMemo } from 'react'
import type { MemberSubsidySelection, SubsidyType } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface Props {
  open: boolean
  subsidyTypes: SubsidyType[]
  memberSubsidies: Record<string, MemberSubsidySelection[]>
  onClose: () => void
}

interface StatRow {
  qq: string
  details: string
  gold: number
}

export function SubsidyStats({ open, subsidyTypes, memberSubsidies, onClose }: Props) {
  const rows = useMemo<StatRow[]>(() => {
    const typeMap = new Map(subsidyTypes.map(t => [t.id, t]))
    const result: StatRow[] = []
    for (const [qq, selections] of Object.entries(memberSubsidies)) {
      let totalGold = 0
      const parts: string[] = []
      for (const sel of selections) {
        const st = typeMap.get(sel.typeId)
        if (!st) continue
        const level = st?.levels.find(l => l.name === sel.levelName)
        if (!level) continue
        const gold = level.gold
        totalGold += gold
        parts.push(`${st.name}${sel.levelName}(${gold}金)`)
      }
      if (parts.length > 0) {
        result.push({ qq, details: parts.join(' + '), gold: totalGold })
      }
    }
    result.sort((a, b) => b.gold - a.gold)
    return result.filter(r => r.gold > 0)
  }, [subsidyTypes, memberSubsidies])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">补贴统计</DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">暂无补贴登记记录</p>
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
                  <td className="py-2 text-foreground">{row.details}</td>
                  <td className="py-2 text-right font-bold text-amber-600">{row.gold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  )
}
