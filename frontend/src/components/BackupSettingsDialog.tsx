import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  fetchBackups,
  importBackupFile,
  restoreBackup,
  type BackupEntry,
  type ServerData,
} from '../api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { formatShanghaiMonthDayTimeMinute } from '../time'

interface Props {
  open: boolean
  onRestored: (data: ServerData) => void
  onClose: () => void
}

interface ConfirmOptions {
  title: string
  message: string
  confirmText: string
  cancelText: string
  destructive?: boolean
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
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  const resolveConfirm = useCallback((confirmed: boolean) => {
    confirmResolveRef.current?.(confirmed)
    confirmResolveRef.current = null
    setConfirmOptions(null)
  }, [])

  const requestConfirm = useCallback((options: ConfirmOptions) => {
    confirmResolveRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOptions(options)
    })
  }, [])

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
    resolveConfirm(false)
    setMessage('')
    onClose()
  }

  const handleBackupNow = async () => {
    const shouldBackup = await requestConfirm({
      title: '立即备份',
      message: '确定备份当前数据？',
      confirmText: '备份',
      cancelText: '取消',
    })
    if (!shouldBackup) return
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
    const shouldBackupCurrent = await requestConfirm({
      title: '回退备份',
      message: '回退前是否先备份当前数据？',
      confirmText: '先备份',
      cancelText: '不备份',
    })
    if (shouldBackupCurrent) {
      setBusy(true)
      setMessage('')
      const backupResult = await createBackup()
      setBusy(false)
      if (!backupResult.ok) {
        setMessage(backupResult.error ?? '回退前备份失败')
        return
      }
      setBackups(backupResult.backups ?? [])
      setMessage('已备份')
    }
    const shouldRestore = await requestConfirm({
      title: '确认回退',
      message: '确定回退到该备份版本？',
      confirmText: '回退',
      cancelText: '取消',
      destructive: true,
    })
    if (!shouldRestore) return
    setBusy(true)
    setMessage('')
    const result = await restoreBackup(name)
    if (result.ok && result.data) {
      onRestored(result.data)
      await loadBackups()
      setMessage(shouldBackupCurrent ? '已备份并回退' : '已回退')
    } else {
      setMessage(result.error ?? '回退失败')
    }
    setBusy(false)
  }

  const handleDelete = async (name: string) => {
    const shouldDelete = await requestConfirm({
      title: '删除备份',
      message: '确定删除该备份？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    })
    if (!shouldDelete) return
    setBusy(true)
    setMessage('')
    const result = await deleteBackup(name)
    if (result.ok) {
      setBackups(result.backups ?? [])
      setMessage('已删除')
    } else {
      setMessage(result.error ?? '删除失败')
    }
    setBusy(false)
  }

  const handleDownload = async (name: string) => {
    setBusy(true)
    setMessage('')
    const result = await downloadBackup(name)
    if (result.ok) {
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename || name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage('已下载')
    } else {
      setMessage(result.error ?? '下载失败')
    }
    setBusy(false)
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    const shouldBackupCurrent = await requestConfirm({
      title: '导入备份',
      message: '导入前是否先备份当前数据？',
      confirmText: '先备份',
      cancelText: '不备份',
    })
    if (shouldBackupCurrent) {
      setBusy(true)
      setMessage('')
      const backupResult = await createBackup()
      setBusy(false)
      if (!backupResult.ok) {
        setMessage(backupResult.error ?? '导入前备份失败')
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      setBackups(backupResult.backups ?? [])
      setMessage('已备份')
    }
    const shouldImport = await requestConfirm({
      title: '确认导入',
      message: '确定导入并恢复该备份？',
      confirmText: '导入并恢复',
      cancelText: '取消',
    })
    if (!shouldImport) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setBusy(true)
    setMessage('')
    const result = await importBackupFile(file)
    if (result.ok && result.data) {
      onRestored(result.data)
      await loadBackups()
      setMessage(shouldBackupCurrent ? '已备份并导入' : '已导入')
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
                    {formatShanghaiMonthDayTimeMinute(backup.createdAt)} · {formatSize(backup.size)}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => { void handleDownload(backup.name) }}
                >
                  下载
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => { void handleRestore(backup.name) }}
                >
                  回退
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => { void handleDelete(backup.name) }}
                >
                  删除
                </Button>
              </div>
            ))}
            {backups.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无备份</p>
            )}
          </div>
        </div>
      </DialogContent>

      <Dialog open={!!confirmOptions} onOpenChange={(value) => { if (!value) resolveConfirm(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{confirmOptions?.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {confirmOptions?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resolveConfirm(false)}
            >
              {confirmOptions?.cancelText}
            </Button>
            <Button
              type="button"
              variant={confirmOptions?.destructive ? 'destructive' : 'default'}
              size="sm"
              onClick={() => resolveConfirm(true)}
            >
              {confirmOptions?.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
