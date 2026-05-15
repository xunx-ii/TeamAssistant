import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import type { SubsidyLevel, SubsidyType } from '../types'
import { saveSubsidyPresets, saveSubsidyPresetsRemote } from '../subsidyPresets'
import { normalizeTextInput, sanitizeIntegerInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'

interface Props {
  open: boolean
  serverMode: boolean
  actorQq?: string | null
  subsidyPresets: SubsidyType[]
  onSaved: (presets: SubsidyType[]) => void
  onClose: () => void
}

interface EditorProps {
  serverMode: boolean
  actorQq?: string | null
  subsidyPresets: SubsidyType[]
  onSaved: (presets: SubsidyType[]) => void
  onClose: () => void
}

export function PresetSubsidyDialog({ open, serverMode, actorQq, subsidyPresets, onSaved, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      {open && <PresetSubsidyEditor serverMode={serverMode} actorQq={actorQq} subsidyPresets={subsidyPresets} onSaved={onSaved} onClose={onClose} />}
    </Dialog>
  )
}

function PresetSubsidyEditor({ serverMode, actorQq, subsidyPresets, onSaved, onClose }: EditorProps) {
  const [presets, setPresets] = useState<SubsidyType[]>(subsidyPresets)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const addType = () => {
    setPresets(prev => [...prev, { id: `preset-${Date.now()}`, name: '', levels: [] }])
  }

  const removeType = (id: string) => {
    setPresets(prev => prev.filter(t => t.id !== id))
  }

  const updateName = (id: string, name: string) => {
    setPresets(prev => prev.map(t => t.id === id ? { ...t, name: sanitizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.subsidyName }) } : t))
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
      levels[idx] = {
        ...levels[idx],
        [field]: field === 'gold'
          ? (parseInt(sanitizeIntegerInput(value, 8)) || 0)
          : sanitizeTextInput(value, { maxLength: TEXT_INPUT_LIMITS.subsidyLevelName }),
      }
      return { ...t, levels }
    }))
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError('')
    try {
      const valid = presets
        .map(t => ({
          ...t,
          name: normalizeTextInput(t.name, { maxLength: TEXT_INPUT_LIMITS.subsidyName }),
          levels: t.levels
            .map(l => ({
              ...l,
              name: normalizeTextInput(l.name, { maxLength: TEXT_INPUT_LIMITS.subsidyLevelName }),
            }))
            .filter(l => l.name),
        }))
        .filter(t => t.name && t.levels.length > 0)
      if (serverMode) {
        const saved = await saveSubsidyPresetsRemote(valid, actorQq)
        if (!saved) {
          setSaveError('保存失败：未同步到服务器，请稍后重试')
          return
        }
      } else {
        saveSubsidyPresets(valid)
      }
      onSaved(valid)
      onClose()
    } finally {
      setSaving(false)
    }
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
                maxLength={TEXT_INPUT_LIMITS.subsidyName}
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
                    maxLength={TEXT_INPUT_LIMITS.subsidyLevelName}
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
          <Button size="sm" variant="outline" onClick={addType} disabled={saving}>+ 新增预设类型</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>保存预设</Button>
        </div>
        {saveError && (
          <p className="text-xs text-destructive">{saveError}</p>
        )}
      </div>
    </DialogContent>
  )
}
