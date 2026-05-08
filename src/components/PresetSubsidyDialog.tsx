import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { SubsidyLevel, SubsidyType } from '../types'
import { loadSubsidyPresets, saveSubsidyPresets } from '../subsidyPresets'

interface Props {
  open: boolean
  onClose: () => void
}

interface EditorProps {
  onClose: () => void
}

export function PresetSubsidyDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      {open && <PresetSubsidyEditor onClose={onClose} />}
    </Dialog>
  )
}

function PresetSubsidyEditor({ onClose }: EditorProps) {
  const [presets, setPresets] = useState<SubsidyType[]>(loadSubsidyPresets)

  const addType = () => {
    setPresets(prev => [...prev, { id: `preset-${Date.now()}`, name: '', levels: [] }])
  }

  const removeType = (id: string) => {
    setPresets(prev => prev.filter(t => t.id !== id))
  }

  const updateName = (id: string, name: string) => {
    setPresets(prev => prev.map(t => t.id === id ? { ...t, name } : t))
  }

  const addLevel = (typeId: string) => {
    setPresets(prev => prev.map(t =>
      t.id === typeId ? { ...t, levels: [...t.levels, { name: '', gold: 0 }] } : t,
    ))
  }

  const removeLevel = (typeId: string, idx: number) => {
    setPresets(prev => prev.map(t =>
      t.id === typeId ? { ...t, levels: t.levels.filter((_, i) => i !== idx) } : t,
    ))
  }

  const updateLevel = (typeId: string, idx: number, field: keyof SubsidyLevel, value: string) => {
    setPresets(prev => prev.map(t => {
      if (t.id !== typeId) return t
      const levels = [...t.levels]
      levels[idx] = { ...levels[idx], [field]: field === 'gold' ? (parseInt(value) || 0) : value }
      return { ...t, levels }
    }))
  }

  const handleSave = () => {
    const valid = presets.filter(t => t.name.trim() && t.levels.length > 0 && t.levels.every(l => l.name.trim()))
    saveSubsidyPresets(valid)
    onClose()
  }

  return (
    <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-sm">补贴预设设置</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        {presets.map(t => (
          <div key={t.id} className="border border-border rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground min-w-[48px]">类型名</span>
              <Input
                className="h-7 text-sm flex-1"
                value={t.name}
                onChange={e => updateName(t.id, e.target.value)}
                placeholder="如：伤害补贴"
              />
              <Button size="xs" variant="outline" onClick={() => removeType(t.id)}>删除</Button>
            </div>
            <div className="space-y-1.5 pl-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground min-w-[48px]">等级</span>
                <Button size="xs" variant="outline" onClick={() => addLevel(t.id)}>+ 新增等级</Button>
              </div>
              {t.levels.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    className="h-7 text-sm w-20"
                    value={l.name}
                    onChange={e => updateLevel(t.id, idx, 'name', e.target.value)}
                    placeholder="第一"
                  />
                  <Input
                    type="number"
                    min={0}
                    className="h-7 text-sm w-24"
                    value={l.gold || ''}
                    onChange={e => updateLevel(t.id, idx, 'gold', e.target.value)}
                    placeholder="8000"
                  />
                  <span className="text-xs text-muted-foreground">金</span>
                  <Button size="xs" variant="outline" onClick={() => removeLevel(t.id, idx)}>移除</Button>
                </div>
              ))}
              {t.levels.length === 0 && (
                <p className="text-xs text-muted-foreground pl-12">暂无等级</p>
              )}
            </div>
          </div>
        ))}
        {presets.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">暂无预设，请新增</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addType}>+ 新增预设类型</Button>
          <Button size="sm" onClick={handleSave}>保存预设</Button>
        </div>
      </div>
    </DialogContent>
  )
}
