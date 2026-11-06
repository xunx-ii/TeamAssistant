import type { SubsidyType } from '../types'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { SubsidyPresetLoader } from './SubsidyPresetLoader'
import { TeamWeekSelector } from './TeamWeekSelector'
import { TeamPublicationFields } from './TeamPublicationFields'
import { resolveTeamPublicationDraft } from '../teamPublication'
import { formatSubsidyPresetPreview } from '../subsidyPresetPreview'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import {
  DEFAULT_INITIAL_RESERVE_COUNTS,
  normalizeCreateTeamReserveCount,
  normalizeTeamBatchCount,
  type CreateTeamGuideValues,
} from '../teamCreation'
import { getCurrentWeekStartKey } from '../week'
import { getMartialArtLabel, martialArts } from '../data/martialArts'

const dpsMartialArtOptions = martialArts
  .map((martialArt, index) => ({ martialArt, index }))
  .filter(option => option.martialArt.role === 'DPS')

interface Props {
  open: boolean
  subsidyPresets: SubsidyType[]
  onConfirm: (values: CreateTeamGuideValues) => void
  onClose: () => void
}

export function CreateTeamDialog({ open, subsidyPresets, onConfirm, onClose }: Props) {
  const [name, setName] = useState('')
  const [count, setCount] = useState(1)
  const [weekStart, setWeekStart] = useState(getCurrentWeekStartKey)
  const [weekTouched, setWeekTouched] = useState(false)
  const [presetDraftIds, setPresetDraftIds] = useState<Set<string>>(() => new Set())
  const [loadedPresetIds, setLoadedPresetIds] = useState<string[]>([])
  const [onlyTnSignup, setOnlyTnSignup] = useState(false)
  const [uniqueQqSignup, setUniqueQqSignup] = useState(false)
  const [nonPublicSignup, setNonPublicSignup] = useState(false)
  const [publicAtInput, setPublicAtInput] = useState('')
  const [quickReserve, setQuickReserve] = useState(false)
  const [reserveT, setReserveT] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
  const [reserveHealer, setReserveHealer] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
  const [reserveBoss, setReserveBoss] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)
  const [reserveDps, setReserveDps] = useState<Array<{ martialArtIndex: number; count: number }>>([])
  const loadedSubsidyPresets = useMemo(() => {
    const loadedIds = new Set(loadedPresetIds)
    return subsidyPresets.filter(preset => loadedIds.has(preset.id))
  }, [loadedPresetIds, subsidyPresets])

  useEffect(() => {
    if (!open || weekTouched) return
    const interval = window.setInterval(() => {
      setWeekStart(getCurrentWeekStartKey())
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [open, weekTouched])


  const reset = () => {
    setName('')
    setCount(1)
    setWeekStart(getCurrentWeekStartKey())
    setWeekTouched(false)
    setPresetDraftIds(new Set())
    setLoadedPresetIds([])
    setOnlyTnSignup(false)
    setUniqueQqSignup(false)
    setNonPublicSignup(false)
    setPublicAtInput('')
    setQuickReserve(false)
    setReserveT(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
    setReserveHealer(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
    setReserveBoss(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)
    setReserveDps([])
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
    if (!trimmed) return
    const publication = resolveTeamPublicationDraft({ nonPublicSignup, publicAtInput })
    if (!publication) return
    const resolvedWeekStart = weekTouched ? weekStart : getCurrentWeekStartKey()
    onConfirm({
      name: trimmed,
      count,
      weekStart: resolvedWeekStart,
      subsidyPresetIds: loadedPresetIds,
      onlyTnSignup,
      uniqueQqSignup,
      ...publication,
      quickReserve,
      reserveT,
      reserveHealer,
      reserveBoss,
      reserveDps: onlyTnSignup ? [] : reserveDps,
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

  const addDpsReserve = () => {
    const selectedIndexes = new Set(reserveDps.map(item => item.martialArtIndex))
    const option = dpsMartialArtOptions.find(item => !selectedIndexes.has(item.index))
    if (!option) return
    setReserveDps(current => [...current, { martialArtIndex: option.index, count: 1 }])
  }

  const updateDpsReserve = (rowIndex: number, patch: Partial<{ martialArtIndex: number; count: number }>) => {
    setReserveDps(current => current.map((item, index) => index === rowIndex ? { ...item, ...patch } : item))
  }

  const removeDpsReserve = (rowIndex: number) => {
    setReserveDps(current => current.filter((_, index) => index !== rowIndex))
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

          <div className="space-y-2">
            <Label htmlFor="create-team-count">创建数量</Label>
            <Input
              id="create-team-count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={e => setCount(normalizeTeamBatchCount(e.target.value))}
            />
          </div>

          <TeamWeekSelector value={weekStart} onChange={handleWeekStartChange} />

          <TeamPublicationFields id="create-team" nonPublicSignup={nonPublicSignup} publicAtInput={publicAtInput} onNonPublicSignupChange={setNonPublicSignup} onPublicAtChange={setPublicAtInput} />

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
                checked={onlyTnSignup}
                onChange={e => setOnlyTnSignup(e.target.checked)}
              />
              仅限TN报名
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={uniqueQqSignup}
                onChange={e => setUniqueQqSignup(e.target.checked)}
              />
              每人仅报名一次
            </label>
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
            <div className="space-y-3">
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
              {!onlyTnSignup && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>DPS心法</Label>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={reserveDps.length >= dpsMartialArtOptions.length}
                      onClick={addDpsReserve}
                    >
                      添加
                    </Button>
                  </div>
                  {reserveDps.map((reserve, rowIndex) => {
                    const selectedByOtherRows = new Set(
                      reserveDps
                        .filter((_, index) => index !== rowIndex)
                        .map(item => item.martialArtIndex),
                    )
                    return (
                      <div key={`${rowIndex}-${reserve.martialArtIndex}`} className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-end gap-2">
                        <Select
                          value={String(reserve.martialArtIndex)}
                          onValueChange={value => updateDpsReserve(rowIndex, { martialArtIndex: Number.parseInt(value, 10) })}
                        >
                          <SelectTrigger aria-label={`DPS心法 ${rowIndex + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dpsMartialArtOptions
                              .filter(option => option.index === reserve.martialArtIndex || !selectedByOtherRows.has(option.index))
                              .map(option => (
                                <SelectItem key={option.index} value={String(option.index)}>
                                  {getMartialArtLabel(option.martialArt)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <div className="space-y-1.5">
                          <Label htmlFor={`create-team-reserve-dps-count-${rowIndex}`}>数量</Label>
                          <Input
                            id={`create-team-reserve-dps-count-${rowIndex}`}
                            type="number"
                            min={1}
                            max={25}
                            value={reserve.count}
                            onChange={event => updateDpsReserve(rowIndex, {
                              count: Math.max(1, normalizeCreateTeamReserveCount(event.target.value)),
                            })}
                          />
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={() => removeDpsReserve(rowIndex)}>
                          移除
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
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
