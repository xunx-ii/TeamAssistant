import { useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import {
  DEFAULT_INITIAL_RESERVE_COUNTS,
  normalizeCreateTeamReserveCount,
  type CreateTeamGuideValues,
  type CreateTeamWeekMode,
} from '../teamCreation'
import { getShanghaiDateKey } from '../week'

interface Props {
  open: boolean
  onConfirm: (values: CreateTeamGuideValues) => void
  onClose: () => void
}

const weekOptions: { value: CreateTeamWeekMode; label: string }[] = [
  { value: 'thisWeek', label: '本周' },
  { value: 'nextWeek', label: '下周' },
  { value: 'custom', label: '自定义时间' },
]

export function CreateTeamDialog({ open, onConfirm, onClose }: Props) {
  const [name, setName] = useState('')
  const [weekMode, setWeekMode] = useState<CreateTeamWeekMode>('thisWeek')
  const [customDate, setCustomDate] = useState('')
  const [importSubsidyPresets, setImportSubsidyPresets] = useState(false)
  const [quickReserve, setQuickReserve] = useState(false)
  const [reserveT, setReserveT] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
  const [reserveHealer, setReserveHealer] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
  const [reserveBoss, setReserveBoss] = useState<number>(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)

  const reset = () => {
    setName('')
    setWeekMode('thisWeek')
    setCustomDate('')
    setImportSubsidyPresets(false)
    setQuickReserve(false)
    setReserveT(DEFAULT_INITIAL_RESERVE_COUNTS.reserveT)
    setReserveHealer(DEFAULT_INITIAL_RESERVE_COUNTS.reserveHealer)
    setReserveBoss(DEFAULT_INITIAL_RESERVE_COUNTS.reserveBoss)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
    if (!trimmed) return
    onConfirm({
      name: trimmed,
      weekMode,
      customDate,
      importSubsidyPresets,
      quickReserve,
      reserveT,
      reserveHealer,
      reserveBoss,
    })
    reset()
  }

  const handleWeekModeChange = (mode: CreateTeamWeekMode) => {
    setWeekMode(mode)
    if (mode === 'custom' && !customDate) {
      setCustomDate(getShanghaiDateKey())
    }
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
            <Label>本次团队时间</Label>
            <div className="grid grid-cols-3 gap-2">
              {weekOptions.map(option => (
                <Button
                  key={option.value}
                  type="button"
                  variant={weekMode === option.value ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={weekMode === option.value}
                  onClick={() => handleWeekModeChange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {weekMode === 'custom' && (
              <Input
                aria-label="自定义团队日期"
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={importSubsidyPresets}
                onChange={e => setImportSubsidyPresets(e.target.checked)}
              />
              导入补贴预设
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
