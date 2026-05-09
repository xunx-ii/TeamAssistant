import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  addWeeksToWeekStartKey,
  formatWeekRange,
  getCurrentWeekStartKey,
  getShanghaiDateKey,
  getWeekStartKeyFromDateKey,
} from '../week'

interface Props {
  value: string
  onChange: (weekStart: string) => void
  label?: string
  customDateLabel?: string
  referenceWeekStart?: string
}

export function TeamWeekSelector({ value, onChange, label = '本次团队时间', customDateLabel = '自定义团队日期', referenceWeekStart }: Props) {
  const baseWeekStart = useMemo(() => referenceWeekStart || getCurrentWeekStartKey(), [referenceWeekStart])
  const nextWeekStart = useMemo(() => addWeeksToWeekStartKey(baseWeekStart, 1), [baseWeekStart])
  const resolvedValue = value || baseWeekStart
  const [customOpen, setCustomOpen] = useState(false)
  const derivedMode = resolvedValue === baseWeekStart
    ? 'thisWeek'
    : (resolvedValue === nextWeekStart ? 'nextWeek' : 'custom')
  const selectedMode = customOpen ? 'custom' : derivedMode

  const handleCustomDateChange = (date: string) => {
    onChange(getWeekStartKeyFromDateKey(date, baseWeekStart))
  }

  const handleCustomMode = () => {
    setCustomOpen(true)
    if (derivedMode !== 'custom') {
      const date = getShanghaiDateKey()
      onChange(getWeekStartKeyFromDateKey(date, baseWeekStart))
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant={selectedMode === 'thisWeek' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={selectedMode === 'thisWeek'}
          onClick={() => {
            setCustomOpen(false)
            onChange(baseWeekStart)
          }}
        >
          本周
        </Button>
        <Button
          type="button"
          variant={selectedMode === 'nextWeek' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={selectedMode === 'nextWeek'}
          onClick={() => {
            setCustomOpen(false)
            onChange(nextWeekStart)
          }}
        >
          下周
        </Button>
        <Button
          type="button"
          variant={selectedMode === 'custom' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={selectedMode === 'custom'}
          onClick={handleCustomMode}
        >
          自定义时间
        </Button>
      </div>
      {selectedMode === 'custom' && (
        <Input
          aria-label={customDateLabel}
          type="date"
          value={resolvedValue}
          onChange={e => handleCustomDateChange(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground" aria-label="团队时间预览">
        预览：{formatWeekRange(resolvedValue)}
      </p>
    </div>
  )
}
