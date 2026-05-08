import { useMemo, useState } from 'react'
import type { MemberSubsidySelection, SubsidyTarget } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface Props {
  open: boolean
  targets: SubsidyTarget[]
  onConfirm: (target: SubsidyTarget, selections: MemberSubsidySelection[]) => void
  onClose: () => void
}

export function SubsidyModal({ open, targets, onConfirm, onClose }: Props) {
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [selectionDrafts, setSelectionDrafts] = useState<Record<string, MemberSubsidySelection[]>>({})

  const resolvedTargetId = targets.some(target => target.id === selectedTargetId)
    ? selectedTargetId
    : (targets[0]?.id ?? '')
  const selectedTarget = useMemo(
    () => targets.find(target => target.id === resolvedTargetId) ?? null,
    [resolvedTargetId, targets],
  )
  const selections = useMemo(
    () => (resolvedTargetId ? (selectionDrafts[resolvedTargetId] ?? selectedTarget?.currentSelections ?? []) : []),
    [resolvedTargetId, selectedTarget, selectionDrafts],
  )

  const updateSelections = (updater: (current: MemberSubsidySelection[]) => MemberSubsidySelection[]) => {
    if (!resolvedTargetId) return
    setSelectionDrafts(prev => {
      const current = prev[resolvedTargetId] ?? selectedTarget?.currentSelections ?? []
      return {
        ...prev,
        [resolvedTargetId]: updater(current).map(selection => ({ ...selection })),
      }
    })
  }

  const isSelected = (typeId: string, levelName: string) =>
    selections.some(s => s.typeId === typeId && s.levelName === levelName)

  const getLevelGold = (typeId: string, levelName: string) => {
    const st = selectedTarget?.subsidyTypes.find(t => t.id === typeId)
    return st?.levels.find(l => l.name === levelName)?.gold ?? 0
  }

  const toggleLevel = (typeId: string, levelName: string) => {
    updateSelections(prev => {
      const existing = prev.find(s => s.typeId === typeId && s.levelName === levelName)
      if (existing) {
        return prev.filter(s => !(s.typeId === typeId && s.levelName === levelName))
      }
      return [...prev.filter(s => s.typeId !== typeId), { typeId, levelName }]
    })
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    onConfirm(selectedTarget, selections)
    onClose()
  }

  const totalGold = selections.reduce((sum, s) => sum + getLevelGold(s.typeId, s.levelName), 0)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">补贴登记</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">暂无可登记补贴的团队</p>
          ) : (
            <Select value={resolvedTargetId} onValueChange={setSelectedTargetId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="选择团队" />
              </SelectTrigger>
              <SelectContent>
                {targets.map(target => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedTarget && (
            <>
              {selectedTarget.subsidyTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">暂无补贴类型，请联系管理员设置</p>
              ) : (
                selectedTarget.subsidyTypes.map(st => (
                  <div key={st.id} className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground">{st.name}</p>
                    <div className="space-y-1">
                      {st.levels.map(level => {
                        const selected = isSelected(st.id, level.name)
                        return (
                          <div
                            key={level.name}
                            className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors ${
                              selected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border hover:border-muted-foreground/30 text-muted-foreground'
                            }`}
                            onClick={() => toggleLevel(st.id, level.name)}
                          >
                            <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              selected ? 'border-primary' : 'border-muted-foreground/40'
                            }`}>
                              {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
                            </div>
                            <span className="flex-1 text-xs">
                              {level.name} ({level.gold}金)
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
              {selections.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-foreground">
                    合计：<span className="font-bold text-amber-600">{totalGold}</span> 金
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selectedTarget}>保存登记</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
