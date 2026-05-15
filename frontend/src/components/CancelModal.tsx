import { useEffect, useRef, useState } from 'react'
import { acquireSlotLock, releaseSlotLock } from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'

interface Props {
  open: boolean
  memberName: string
  qq: string | null
  teamId?: string
  slotIndex: number | null
  requireLock?: boolean
  onConfirm: (reason: string, lockTimestamp?: number) => void
  onClose: () => void
}

export function CancelModal({ open, memberName, qq, teamId, slotIndex, requireLock = false, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [lockTimestamp, setLockTimestamp] = useState<number>(0)
  const [error, setError] = useState('')
  const lockTimestampRef = useRef(0)
  const shouldLock = requireLock

  useEffect(() => {
    if (!open || !qq || !teamId || slotIndex == null || !shouldLock) return
    let active = true
    const acquire = async () => {
      const result = await acquireSlotLock(teamId, slotIndex, qq)
      if (!active) return
      if (result.ok && result.timestamp) {
        lockTimestampRef.current = result.timestamp
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
      const currentLockTimestamp = lockTimestampRef.current
      lockTimestampRef.current = 0
      if (currentLockTimestamp > 0) {
        void releaseSlotLock(teamId, slotIndex, qq, currentLockTimestamp)
      }
      setLockTimestamp(0)
      setError('')
      setReason('')
    }
  }, [open, qq, teamId, slotIndex, shouldLock])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const textReason = normalizeTextInput(reason, { maxLength: TEXT_INPUT_LIMITS.cancelReason, multiline: true })
    if (!textReason || error) return
    if (shouldLock && lockTimestamp <= 0) {
      setError('正在锁定该位置，请稍后再提交')
      return
    }
    setReason(textReason)
    onConfirm(textReason, lockTimestamp)
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
            <Textarea
              value={reason}
              maxLength={TEXT_INPUT_LIMITS.cancelReason}
              onChange={e => setReason(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.cancelReason, multiline: true }))}
              placeholder="填写取消原因"
              rows={3}
            />
          </div>
          <Button type="submit" variant="destructive" className="w-full" disabled={shouldLock && lockTimestamp <= 0}>确认取消</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
