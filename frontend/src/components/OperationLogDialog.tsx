import { useEffect, useMemo, useState } from 'react'
import type { OperationLog } from '../types'
import type { HistoryPageResult } from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { formatShanghaiMonthDayTimeSecond } from '../time'

interface Props {
  open: boolean
  teamName: string
  logs: OperationLog[]
  /**
   * 是否提示「服务器还有更早的日志可以加载」。bootstrap 已经只下发最近一段，
   * 调用方应根据 `serverData.logsTruncated` 决定是否传 true。
   */
  hasMore?: boolean
  /**
   * 由调用方负责拉分页：调用方知道当前作用域（按团 / 全局）以及 actorQq 等上下文。
   * 未提供时弹窗只展示父组件传入的 logs。
   */
  onLoadMore?: (cursor: number) => Promise<HistoryPageResult<OperationLog>>
  onClose: () => void
}

const PAGE_SIZE_HINT = 200

export function OperationLogDialog({ open, teamName, logs, hasMore, onLoadMore, onClose }: Props) {
  const [olderLogs, setOlderLogs] = useState<OperationLog[]>([])
  const [serverHasMore, setServerHasMore] = useState<boolean>(Boolean(hasMore))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 关闭弹窗时清掉「更早日志」这部分缓存，避免下次打开看到旧数据
  // 同时根据父组件最新的 hasMore 重新初始化按钮可见性
  useEffect(() => {
    if (open) {
      setServerHasMore(Boolean(hasMore))
      setError(null)
    } else {
      setOlderLogs([])
      setServerHasMore(false)
      setLoading(false)
      setError(null)
    }
  }, [open, hasMore])

  const sortedLogs = useMemo(() => {
    // 按 id 去重，避免本地 logs 与分页拉到的更早日志在边界上重复
    const seen = new Set<string>()
    const merged: OperationLog[] = []
    for (const log of logs) {
      if (log.id && !seen.has(log.id)) {
        seen.add(log.id)
        merged.push(log)
      }
    }
    for (const log of olderLogs) {
      if (log.id && !seen.has(log.id)) {
        seen.add(log.id)
        merged.push(log)
      }
    }
    merged.sort((left, right) => right.timestamp - left.timestamp)
    return merged
  }, [logs, olderLogs])

  const oldestLoadedTimestamp = sortedLogs.length > 0 ? sortedLogs[sortedLogs.length - 1].timestamp : null

  const canLoadMore = Boolean(onLoadMore && serverHasMore && oldestLoadedTimestamp != null)

  const loadMore = async () => {
    if (!onLoadMore || oldestLoadedTimestamp == null || loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await onLoadMore(oldestLoadedTimestamp)
      if (!page.ok) {
        setError(page.error ?? '加载更早日志失败')
        return
      }
      setOlderLogs(prev => {
        const seen = new Set(prev.map(log => log.id))
        const next = [...prev]
        for (const item of page.items) {
          if (item.id && !seen.has(item.id)) {
            seen.add(item.id)
            next.push(item)
          }
        }
        return next
      })
      setServerHasMore(Boolean(page.hasMore))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更早日志失败')
    } finally {
      setLoading(false)
    }
  }

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
              {canLoadMore && (
                <div className="flex items-center justify-center gap-2 px-3 py-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? '加载中…' : `加载更早 ${PAGE_SIZE_HINT} 条`}
                  </Button>
                </div>
              )}
              {error && (
                <div className="px-3 py-2 text-center text-xs text-destructive">{error}</div>
              )}
              {!canLoadMore && onLoadMore && !serverHasMore && sortedLogs.length > 0 && (
                <div className="px-3 py-2 text-center text-xs text-muted-foreground">已加载全部历史日志</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
