import { useState, type FormEvent } from 'react'
import { normalizeTeamBatchCount } from '../teamCreation'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface Props {
  open: boolean
  sourceName: string
  onConfirm: (values: { name: string; count: number }) => void
  onClose: () => void
}

function getDefaultCopyName(sourceName: string) {
  return normalizeTextInput(`${sourceName} 副本`, { maxLength: TEXT_INPUT_LIMITS.teamName })
}

export function CopyTeamDialog({ open, sourceName, onConfirm, onClose }: Props) {
  const [name, setName] = useState(() => getDefaultCopyName(sourceName))
  const [count, setCount] = useState(1)

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const normalizedName = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
    if (!normalizedName) return
    onConfirm({ name: normalizedName, count: normalizeTeamBatchCount(count) })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>复制团队</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="copy-team-name">团队名称</Label>
            <Input
              id="copy-team-name"
              autoFocus
              value={name}
              maxLength={TEXT_INPUT_LIMITS.teamName}
              onChange={event => setName(sanitizeTextInput(event.target.value, { maxLength: TEXT_INPUT_LIMITS.teamName }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="copy-team-count">创建数量</Label>
            <Input
              id="copy-team-count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={event => setCount(normalizeTeamBatchCount(event.target.value))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit">创建</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
