import { useEffect, useMemo, useRef, useState } from 'react'
import type { OperationLog } from '../types'
import type { HistoryPageResult } from '../api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { formatShanghaiMonthDayTimeSecond } from '../time'
import { formatOperationLogActor, OPERATION_LOG_LOCAL_FALLBACK_LIMIT, OPERATION_LOG_PAGE_SIZE } from '../operationLogs'

interface Props {
  open: boolean
  title: string
  showTeamName?: boolean
  isAdmin: boolean
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
  onLoadInitial?: (signal: AbortSignal) => Promise<HistoryPageResult<OperationLog>>
  onLoadMore?: (cursor: number, signal: AbortSignal) => Promise<HistoryPageResult<OperationLog>>
  onClose: () => void
}

export function OperationLogDialog({ open, title, showTeamName = false, isAdmin, logs, hasMore, onLoadInitial, onLoadMore, onClose }: Props) {
  const [initialLogs, setInitialLogs] = useState<OperationLog[]>([])
  const [olderLogs, setOlderLogs] = useState<OperationLog[]>([])
  const [serverHasMore, setServerHasMore] = useState<boolean>(Boolean(hasMore))
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onLoadInitialRef = useRef(onLoadInitial)
  const onLoadMoreRef = useRef(onLoadMore)

  useEffect(() => {
    onLoadInitialRef.current = onLoadInitial
  }, [onLoadInitial])

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setInitialLogs([])
      setOlderLogs([])
      setServerHasMore(Boolean(hasMore))
      setLoading(false)
      setError(null)
      const loadInitial = onLoadInitialRef.current
      setLoadingInitial(Boolean(open && loadInitial))
      if (!open || !loadInitial) return

      void (async () => {
        try {
          const page = await loadInitial(controller.signal)
          if (controller.signal.aborted) return
          if (!page.ok) {
            setError(page.error ?? '加载日志失败')
            return
          }
          setInitialLogs(page.items)
          setServerHasMore(Boolean(page.hasMore))
        } catch (loadError) {
          if (!controller.signal.aborted) {
            setError(loadError instanceof Error ? loadError.message : '加载日志失败')
          }
        } finally {
          if (!controller.signal.aborted) setLoadingInitial(false)
        }
      })()
    })

    return () => controller.abort()
  }, [open, hasMore])

  const sortedLogs = useMemo(() => {
    // 按 id 去重，避免本地 logs 与分页拉到的更早日志在边界上重复
    const seen = new Set<string>()
    const merged: OperationLog[] = []
    for (const log of logs.slice(-OPERATION_LOG_LOCAL_FALLBACK_LIMIT)) {
      if (log.id && !seen.has(log.id)) {
        seen.add(log.id)
        merged.push(log)
      }
    }
    for (const log of initialLogs) {
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
  }, [initialLogs, logs, olderLogs])

  const oldestLoadedTimestamp = sortedLogs.length > 0 ? sortedLogs[sortedLogs.length - 1].timestamp : null

  const canLoadMore = Boolean(!loadingInitial && onLoadMore && serverHasMore && oldestLoadedTimestamp != null)
  const gridColumns = showTeamName
    ? 'grid-cols-[88px_84px_110px_1fr]'
    : 'grid-cols-[92px_96px_1fr]'

  const loadMore = async () => {
    const loadMoreHandler = onLoadMoreRef.current
    if (!loadMoreHandler || oldestLoadedTimestamp == null || loading) return
    const controller = abortRef.current ?? new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const page = await loadMoreHandler(oldestLoadedTimestamp, controller.signal)
      if (controller.signal.aborted) return
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
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : '加载更早日志失败')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          {loadingInitial && (
            <div className="border-b border-border px-3 py-2 text-center text-xs text-muted-foreground">正在加载最新日志…</div>
          )}
          {sortedLogs.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loadingInitial ? '正在加载日志…' : error ? '日志加载失败' : '暂无日志'}
            </div>
          ) : (
            <div className="divide-y divide-border text-sm">
              <div className={`grid ${gridColumns} gap-2 bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground`}>
                <span>时间</span>
                <span>用户</span>
                {showTeamName && <span>团队</span>}
                <span>操作</span>
              </div>
              {sortedLogs.map(log => (
                <div key={log.id} className={`grid ${gridColumns} gap-2 px-3 py-2`}>
                  <span className="font-mono text-[11px] text-muted-foreground">{formatShanghaiMonthDayTimeSecond(log.timestamp)}</span>
                  <span className="truncate font-mono text-xs text-foreground">{formatOperationLogActor(log.actorQq, isAdmin)}</span>
                  {showTeamName && <span className="truncate text-xs text-muted-foreground">{log.teamName || '-'}</span>}
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
                    {loading ? '加载中…' : `加载更早 ${OPERATION_LOG_PAGE_SIZE} 条`}
                  </Button>
                </div>
              )}
              {!canLoadMore && onLoadMore && !serverHasMore && sortedLogs.length > 0 && (
                <div className="px-3 py-2 text-center text-xs text-muted-foreground">已加载全部历史日志</div>
              )}
            </div>
          )}
          {error && (
            <div className="border-t border-border px-3 py-2 text-center text-xs text-destructive">{error}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
