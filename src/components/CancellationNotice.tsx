import type { Cancellation } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

interface Props {
  open: boolean
  notice: Cancellation
  onDismiss: () => void
}

export function CancellationNotice({ open, notice, onDismiss }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => onDismiss()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>报名已被取消</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground space-y-3">
          <p>
            你在「<strong className="text-foreground">{notice.teamName}</strong>」位置
            <strong className="text-foreground"> #{notice.slotIndex + 1}</strong> 的报名已被管理员取消。
          </p>
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-xs font-medium text-destructive mb-1">取消原因：</p>
            <p className="text-sm text-foreground">{notice.reason}</p>
          </div>
        </div>
        <Button className="w-full" onClick={onDismiss}>知道了</Button>
      </DialogContent>
    </Dialog>
  )
}
