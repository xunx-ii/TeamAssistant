import type { OperationLog } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { formatShanghaiMonthDayTimeSecond } from '../time'

interface Props {
  open: boolean
  teamName: string
  logs: OperationLog[]
  onClose: () => void
}

export function OperationLogDialog({ open, teamName, logs, onClose }: Props) {
  const sortedLogs = [...logs].sort((left, right) => right.timestamp - left.timestamp)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{teamName ? `${teamName} 日志` : '操作日志'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          {sortedLogs.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无日志</div>
          ) : (
            <div className="divide-y divide-border text-sm">
              <div className="grid grid-cols-[92px_96px_1fr] gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>时间</span>
                <span>用户</span>
                <span>操作</span>
              </div>
              {sortedLogs.map(log => (
                <div key={log.id} className="grid grid-cols-[92px_96px_1fr] gap-2 px-3 py-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{formatShanghaiMonthDayTimeSecond(log.timestamp)}</span>
                  <span className="truncate font-mono text-xs text-foreground">{log.actorQq || '-'}</span>
                  <span className="break-words text-foreground">{log.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
