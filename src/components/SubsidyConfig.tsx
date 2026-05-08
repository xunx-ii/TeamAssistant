import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { SubsidyType } from '../types'
import { loadSubsidyPresets } from '../subsidyPresets'

interface Props {
  open: boolean
  subsidyTypes: SubsidyType[]
  onSave: (types: SubsidyType[]) => void
  onClose: () => void
}

export function SubsidyConfigDialog({ open, subsidyTypes, onSave, onClose }: Props) {
  const [types, setTypes] = useState<SubsidyType[]>(() =>
    subsidyTypes.map(t => ({
      ...t,
      levels: t.levels.map(l => ({ ...l })),
    })),
  )
  const [dirty, setDirty] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [checkedPresets, setCheckedPresets] = useState<Set<string>>(new Set())
  const presetRef = useRef<HTMLDivElement>(null)

  const markDirty = () => setDirty(true)
  const presets = loadSubsidyPresets()

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setShowPresets(false)
      }
    }
    if (showPresets) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showPresets])

  const addType = () => {
    setTypes(prev => [...prev, { id: String(Date.now()), name: '', levels: [] }])
    markDirty()
  }

  const removeType = (typeId: string) => {
    setTypes(prev => prev.filter(t => t.id !== typeId))
    markDirty()
  }

  const updateTypeName = (typeId: string, name: string) => {
    setTypes(prev => prev.map(t => t.id === typeId ? { ...t, name } : t))
    markDirty()
  }

  const addLevel = (typeId: string) => {
    setTypes(prev => prev.map(t =>
      t.id === typeId
        ? { ...t, levels: [...t.levels, { name: '', gold: 0 }] }
        : t,
    ))
    markDirty()
  }

  const removeLevel = (typeId: string, levelIndex: number) => {
    setTypes(prev => prev.map(t =>
      t.id === typeId
        ? { ...t, levels: t.levels.filter((_, i) => i !== levelIndex) }
        : t,
    ))
    markDirty()
  }

  const updateLevel = (typeId: string, levelIndex: number, field: 'name' | 'gold', value: string) => {
    setTypes(prev => prev.map(t => {
      if (t.id !== typeId) return t
      const levels = [...t.levels]
      levels[levelIndex] = {
        ...levels[levelIndex],
        [field]: field === 'gold' ? (parseInt(value) || 0) : value,
      }
      return { ...t, levels }
    }))
    markDirty()
  }

  const togglePresetCheck = (id: string) => {
    setCheckedPresets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const applyCheckedPresets = () => {
    if (checkedPresets.size === 0) return
    const newTypes = presets
      .filter(p => checkedPresets.has(p.id))
      .map(p => ({
        ...p,
        id: `${p.id}-${Date.now()}`,
        levels: p.levels.map(l => ({ ...l })),
      }))
    setTypes(prev => [...prev, ...newTypes])
    setCheckedPresets(new Set())
    setShowPresets(false)
    markDirty()
  }

  const handleSave = () => {
    const valid = types.filter(t => t.name.trim() && t.levels.length > 0)
    onSave(valid)
    setDirty(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">补贴设置</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {types.map(t => (
            <div key={t.id} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground min-w-[48px]">类型名</span>
                <Input
                  className="h-7 text-sm flex-1"
                  value={t.name}
                  onChange={e => updateTypeName(t.id, e.target.value)}
                  placeholder="如：伤害补贴"
                />
                <Button size="xs" variant="outline" onClick={() => removeType(t.id)}>删除</Button>
              </div>
              <div className="space-y-1.5 pl-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground min-w-[48px]">等级</span>
                  <Button size="xs" variant="outline" onClick={() => addLevel(t.id)}>+ 新增等级</Button>
                </div>
                {t.levels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="h-7 text-sm w-20"
                      value={level.name}
                      onChange={e => updateLevel(t.id, idx, 'name', e.target.value)}
                      placeholder="第一"
                    />
                    <Input
                      type="number"
                      min={0}
                      className="h-7 text-sm w-24"
                      value={level.gold || ''}
                      onChange={e => updateLevel(t.id, idx, 'gold', e.target.value)}
                      placeholder="8000"
                    />
                    <span className="text-xs text-muted-foreground">金</span>
                    <Button size="xs" variant="outline" onClick={() => removeLevel(t.id, idx)}>移除</Button>
                  </div>
                ))}
                {t.levels.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-12">暂无等级，点击上方按钮新增</p>
                )}
              </div>
            </div>
          ))}
          {types.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">暂无补贴类型</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap pt-1">
          <Button size="sm" variant="outline" onClick={addType}>+ 新增补贴类型</Button>
          <div className="relative" ref={presetRef}>
            <Button size="sm" variant="outline" onClick={() => setShowPresets(p => !p)}>
              载入预设 ▾
            </Button>
            {showPresets && presets.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 bg-background border border-border rounded shadow-lg p-2 min-w-[200px] z-10">
                <div className="space-y-1 mb-2">
                  {presets.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-muted rounded cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-primary"
                        checked={checkedPresets.has(p.id)}
                        onChange={() => togglePresetCheck(p.id)}
                      />
                      <span className="text-foreground">{p.name}</span>
                      <span className="text-muted-foreground">
                        ({p.levels.map(l => `${l.name}:${l.gold}`).join(', ')})
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  size="xs"
                  className="w-full"
                  disabled={checkedPresets.size === 0}
                  onClick={applyCheckedPresets}
                >
                  载入选中的预设
                </Button>
              </div>
            )}
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave}>保存补贴</Button>
          )}
          {!dirty && (
            <Button size="sm" onClick={onClose}>关闭</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
