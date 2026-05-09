import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import type { SubsidyType } from '../types'
import { formatSubsidyPresetPreview } from '../subsidyPresetPreview'

interface Props {
  presets: SubsidyType[]
  checkedIds: Set<string>
  onToggle: (id: string) => void
  onApply: () => void
  applyDisabled?: boolean
  inline?: boolean
}

export function SubsidyPresetLoader({ presets, checkedIds, onToggle, onApply, applyDisabled = false, inline = false }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const handleApply = () => {
    onApply()
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="outline" type="button" onClick={() => setOpen(value => !value)}>
        载入预设 ▾
      </Button>
      {open && (
        <div className={inline
          ? 'mt-2 rounded border border-border bg-background p-2 shadow-sm'
          : 'absolute left-0 top-full mt-1 bg-background border border-border rounded shadow-lg p-2 min-w-[220px] max-w-[min(80vw,360px)] z-20'
        }>
          {presets.length > 0 ? (
            <div className="mb-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {presets.map(preset => (
                <label key={preset.id} className="flex items-start gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3 w-3 accent-primary"
                    checked={checkedIds.has(preset.id)}
                    onChange={() => onToggle(preset.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-foreground">{preset.name}</span>
                    <span className="block text-muted-foreground break-words">
                      {formatSubsidyPresetPreview(preset)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">暂无预设</p>
          )}
          <Button
            size="xs"
            className="w-full"
            type="button"
            disabled={applyDisabled || checkedIds.size === 0 || presets.length === 0}
            onClick={handleApply}
          >
            载入选中的预设
          </Button>
        </div>
      )}
    </div>
  )
}
