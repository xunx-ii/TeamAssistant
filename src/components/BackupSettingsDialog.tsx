import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createBackup,
  fetchBackups,
  importBackupFile,
  restoreBackup,
  type BackupEntry,
  type ServerData,
} from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

interface Props {
  open: boolean
  onRestored: (data: ServerData) => void
  onClose: () => void
}

function formatBackupTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function BackupSettingsDialog({ open, onRestored, onClose }: Props) {
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBackups = useCallback(async () => {
    const result = await fetchBackups()
    if (result.ok) {
      setBackups(result.backups ?? [])
      return
    }
    setMessage(result.error ?? '读取备份失败')
  }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    void fetchBackups().then(result => {
      if (!active) return
      if (result.ok) {
        setBackups(result.backups ?? [])
      } else {
        setMessage(result.error ?? '读取备份失败')
      }
    })
    return () => {
      active = false
    }
  }, [open])

  const handleClose = () => {
    setMessage('')
    onClose()
  }

  const handleBackupNow = async () => {
    setBusy(true)
    setMessage('')
    const result = await createBackup()
    if (result.ok) {
      setBackups(result.backups ?? [])
      setMessage('已备份')
    } else {
      setMessage(result.error ?? '备份失败')
    }
    setBusy(false)
  }

  const handleRestore = async (name: string) => {
    if (!window.confirm('确定回退到该备份版本？')) return
    setBusy(true)
    setMessage('')
    const result = await restoreBackup(name)
    if (result.ok && result.data) {
      onRestored(result.data)
      await loadBackups()
      setMessage('已回退')
    } else {
      setMessage(result.error ?? '回退失败')
    }
    setBusy(false)
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    if (!window.confirm('确定导入并恢复该备份？')) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setBusy(true)
    setMessage('')
    const result = await importBackupFile(file)
    if (result.ok && result.data) {
      onRestored(result.data)
      await loadBackups()
      setMessage('已导入')
    } else {
      setMessage(result.error ?? '导入失败')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">备份设置</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { void handleBackupNow() }} disabled={busy}>
            立即备份
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            导入备份文件
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            className="hidden"
            onChange={event => { void handleImport(event.target.files?.[0]) }}
          />
        </div>

        {message && (
          <p className="text-xs text-muted-foreground">{message}</p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">历史备份列表</h3>
          <div className="max-h-[320px] overflow-y-auto space-y-2">
            {backups.map(backup => (
              <div
                key={backup.name}
                className="flex items-center gap-3 rounded border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{backup.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBackupTime(backup.createdAt)} · {formatSize(backup.size)}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => { void handleRestore(backup.name) }}
                >
                  回退
                </Button>
              </div>
            ))}
            {backups.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无备份</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
