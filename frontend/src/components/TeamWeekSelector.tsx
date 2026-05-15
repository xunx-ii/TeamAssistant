import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  formatWeekRange,
  getCurrentWeekStartKey,
  getNextWeekStartKey,
  getShanghaiDateKey,
  getWeekStartKeyFromDateKey,
} from '../week'

interface Props {
  value: string
  onChange: (weekStart: string) => void
  label?: string
  customDateLabel?: string
}

export function TeamWeekSelector({ value, onChange, label = '本次团队时间', customDateLabel = '自定义团队日期' }: Props) {
  const currentWeekStart = getCurrentWeekStartKey()
  const nextWeekStart = getNextWeekStartKey()
  const resolvedValue = value || currentWeekStart
  const [customOpen, setCustomOpen] = useState(false)
  const derivedMode = resolvedValue === currentWeekStart
    ? 'thisWeek'
    : (resolvedValue === nextWeekStart ? 'nextWeek' : 'custom')
  const selectedMode = customOpen ? 'custom' : derivedMode

  const handleCustomDateChange = (date: string) => {
    onChange(getWeekStartKeyFromDateKey(date, getCurrentWeekStartKey()))
  }

  const handleCustomMode = () => {
    setCustomOpen(true)
    if (derivedMode !== 'custom') {
      const date = getShanghaiDateKey()
      onChange(getWeekStartKeyFromDateKey(date, getCurrentWeekStartKey()))
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
            onChange(getCurrentWeekStartKey())
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
            onChange(getNextWeekStartKey())
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
