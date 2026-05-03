import { useEffect, useState } from 'react'
import { acquireSlotLock, releaseSlotLock } from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

interface Props {
  open: boolean
  memberName: string
  qq: string | null
  teamId?: string
  slotIndex: number | null
  onConfirm: (reason: string, lockTimestamp?: number) => void
  onClose: () => void
}

export function CancelModal({ open, memberName, qq, teamId, slotIndex, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [lockTimestamp, setLockTimestamp] = useState<number>(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !qq || !teamId || slotIndex == null) return
    let active = true
    const acquire = async () => {
      const result = await acquireSlotLock(teamId, slotIndex, qq)
      if (!active) return
      if (result.ok && result.timestamp) {
        setLockTimestamp(result.timestamp)
        setError('')
      } else if (result.reason === 'teamLocked') {
        setError('表格已被管理员锁定')
      } else if (result.lockedBy) {
        setError(`该位置已被 ${result.lockedBy} 先点击`)
      } else {
        setError('无法锁定该位置')
      }
    }

    void acquire()
    return () => {
      active = false
      void releaseSlotLock(teamId, slotIndex, qq)
      setLockTimestamp(0)
      setError('')
      setReason('')
    }
  }, [open, qq, teamId, slotIndex])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim() || error) return
    onConfirm(reason.trim(), lockTimestamp)
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
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
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
