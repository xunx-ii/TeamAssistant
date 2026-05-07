import type { ArchivedTeam } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

interface Props {
  open: boolean
  archives: ArchivedTeam[]
  onRestore: (archiveId: string) => void
  onClose: () => void
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ArchiveDialog({ open, archives, onRestore, onClose }: Props) {
  const sortedArchives = [...archives].sort((left, right) => right.archivedAt - left.archivedAt)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>档案</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          {sortedArchives.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无档案</div>
          ) : (
            <div className="divide-y divide-border">
              {sortedArchives.map(archive => (
                <div key={archive.id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{archive.team.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(archive.archivedAt)} · {archive.archivedBy}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onRestore(archive.id)}>
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
