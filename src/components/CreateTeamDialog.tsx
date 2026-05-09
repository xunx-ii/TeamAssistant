import type { SubsidyType } from '../types'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { SubsidyPresetLoader } from './SubsidyPresetLoader'
import { TeamWeekSelector } from './TeamWeekSelector'
import { formatSubsidyPresetPreview } from '../subsidyPresetPreview'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import {
  DEFAULT_INITIAL_RESERVE_COUNTS,
  normalizeCreateTeamReserveCount,
  type CreateTeamGuideValues,
} from '../teamCreation'
import { getCurrentWeekStartKey } from '../week'

interface Props {
  open: boolean
  subsidyPresets: SubsidyType[]
  onConfirm: (values: CreateTeamGuideValues) => void
  onClose: () => void
}

export function CreateTeamDialog({ open, subsidyPresets, onConfirm, onClose }: Props) {
  const [name, setName] = useState('')
  const [weekStart, setWeekStart] = useState(getCurrentWeekStartKey)
  const [weekTouched, setWeekTouched] = useState(false)
  const [presetDraftIds, setPresetDraftIds] = useState<Set<string>>(() => new Set())
  const [loadedPresetIds, setLoadedPresetIds] = useState<string[]>([])
  const [quickReserve, setQuickReserve] = useState(false)
  const [reserveT, setReserveT] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
  const [reserveHealer, setReserveHealer] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
  const [reserveBoss, setReserveBoss] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)
  const loadedSubsidyPresets = useMemo(() => {
    const loadedIds = new Set(loadedPresetIds)
    return subsidyPresets.filter(preset => loadedIds.has(preset.id))
  }, [loadedPresetIds, subsidyPresets])

  useEffect(() => {
    if (weekTouched) return
    const interval = window.setInterval(() => {
      setWeekStart(getCurrentWeekStartKey())
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [weekTouched])

  const reset = () => {
    setName('')
    setWeekStart(getCurrentWeekStartKey())
    setWeekTouched(false)
    setPresetDraftIds(new Set())
    setLoadedPresetIds([])
    setQuickReserve(false)
    setReserveT(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
    setReserveHealer(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
    setReserveBoss(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
    if (!trimmed) return
    const resolvedWeekStart = weekTouched ? weekStart : getCurrentWeekStartKey()
    onConfirm({
      name: trimmed,
      weekStart: resolvedWeekStart,
      subsidyPresetIds: loadedPresetIds,
      quickReserve,
      reserveT,
      reserveHealer,
      reserveBoss,
    })
    reset()
  }

  const togglePresetDraft = (id: string) => {
    setPresetDraftIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyPresetDraft = () => {
    setLoadedPresetIds([...presetDraftIds])
  }

  const handleWeekStartChange = (value: string) => {
    setWeekTouched(true)
    setWeekStart(value)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="max-w-md max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建团队</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="create-team-name">团队名称</Label>
            <Input
              id="create-team-name"
              autoFocus
              placeholder="输入团队名称"
              value={name}
              maxLength={TEXT_INPUT_LIMITS.teamName}
              onChange={e => setName(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.teamName }))}
            />
          </div>

          <TeamWeekSelector value={weekStart} onChange={handleWeekStartChange} />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SubsidyPresetLoader
                presets={subsidyPresets}
                checkedIds={presetDraftIds}
                onToggle={togglePresetDraft}
                onApply={applyPresetDraft}
                inline
              />
            </div>
            {loadedSubsidyPresets.length > 0 && (
              <div className="space-y-1 rounded border border-border p-2">
                {loadedSubsidyPresets.map(preset => (
                  <p key={preset.id} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{preset.name}</span>
                    {' '}
                    {formatSubsidyPresetPreview(preset)}
                  </p>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={quickReserve}
                onChange={e => setQuickReserve(e.target.checked)}
              />
              一键限坑
            </label>
          </div>

          {quickReserve && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-team-reserve-t">T</Label>
                <Input
                  id="create-team-reserve-t"
                  type="number"
                  min={0}
                  max={25}
                  value={reserveT}
                  onChange={e => setReserveT(normalizeCreateTeamReserveCount(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-team-reserve-healer">奶</Label>
                <Input
                  id="create-team-reserve-healer"
                  type="number"
                  min={0}
                  max={25}
                  value={reserveHealer}
                  onChange={e => setReserveHealer(normalizeCreateTeamReserveCount(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-team-reserve-boss">老板</Label>
                <Input
                  id="create-team-reserve-boss"
                  type="number"
                  min={0}
                  max={25}
                  value={reserveBoss}
                  onChange={e => setReserveBoss(normalizeCreateTeamReserveCount(e.target.value))}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { onClose(); reset() }}>取消</Button>
            <Button type="submit">创建</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
