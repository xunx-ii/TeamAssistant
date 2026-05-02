import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface Props {
  open: boolean
  onConfirm: (name: string) => void
  onClose: () => void
}

export function CreateTeamDialog({ open, onConfirm, onClose }: Props) {
  const [name, setName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    setName('')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setName('') } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>创建团队</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            autoFocus
            placeholder="输入团队名称"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <Button type="submit">创建</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
