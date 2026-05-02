import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

interface Props {
  open: boolean
  memberName: string
  onConfirm: (reason: string) => void
  onClose: () => void
}

export function CancelModal({ open, memberName, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return
    onConfirm(reason.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>取消报名</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          取消 <strong className="text-foreground">{memberName}</strong> 的报名
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>取消原因</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="填写取消原因" rows={3} />
          </div>
          <Button type="submit" variant="destructive" className="w-full">确认取消</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
