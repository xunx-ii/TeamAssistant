import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
  fetchAccessGate,
  regenerateAccessGateToken,
  saveAccessGate,
  type AccessGateState,
} from '../api'
import {
  formatShanghaiDateTimeLocalInput,
  formatShanghaiDateTimeMinute,
  parseShanghaiDateTimeLocalInput,
} from '../time'

interface Props {
  open: boolean
  actorQq: string | null
  onUpdated: (gate: AccessGateState) => void
  onClose: () => void
}

function inviteLink(token: string) {
  if (typeof window === 'undefined' || !token) return ''
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('invite', token)
  return url.toString()
}

export function AccessGateDialog({ open, actorQq, onUpdated, onClose }: Props) {
  const [gate, setGate] = useState<AccessGateState | null>(null)
  const [publicAtInput, setPublicAtInput] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const link = useMemo(() => inviteLink(gate?.inviteToken ?? ''), [gate?.inviteToken])

  useEffect(() => {
    if (!open || !actorQq) return
    let active = true
    Promise.resolve().then(async () => {
      if (!active) return
      setLoading(true)
      setMessage('')
      const result = await fetchAccessGate(actorQq)
      if (active) {
        if (result.ok) {
          setGate(result)
          setPublicAtInput(result.publicAtMs > 0 ? formatShanghaiDateTimeLocalInput(result.publicAtMs) : '')
          onUpdated(result)
        } else {
          setMessage(result.error || '读取失败')
        }
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [actorQq, onUpdated, open])

  const applyGate = (next: AccessGateState) => {
    setGate(next)
    setPublicAtInput(next.publicAtMs > 0 ? formatShanghaiDateTimeLocalInput(next.publicAtMs) : '')
    onUpdated(next)
  }

  const handleSave = async () => {
    if (!actorQq) return
    setMessage('')
    const publicAtMs = publicAtInput ? parseShanghaiDateTimeLocalInput(publicAtInput) : 0
    if (publicAtMs === null) {
      setMessage('时间格式不正确')
      return
    }
    setLoading(true)
    const result = await saveAccessGate(publicAtMs, actorQq)
    setLoading(false)
    if (result.ok) {
      applyGate(result)
      setMessage('已保存')
    } else {
      setMessage(result.error || '保存失败')
    }
  }

  const handleRegenerate = async () => {
    if (!actorQq) return
    setMessage('')
    setLoading(true)
    const result = await regenerateAccessGateToken(actorQq)
    setLoading(false)
    if (result.ok) {
      applyGate(result)
      setMessage('链接已重生成')
    } else {
      setMessage(result.error || '重生成失败')
    }
  }

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setMessage('已复制')
    } catch {
      setMessage(link)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">提前报名</DialogTitle>
          <DialogDescription>
            {gate?.publicAtMs ? `公开时间：${formatShanghaiDateTimeMinute(gate.publicAtMs)}` : '当前公开'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground" htmlFor="access-public-at">公开时间</label>
            <Input
              id="access-public-at"
              type="datetime-local"
              value={publicAtInput}
              onChange={event => setPublicAtInput(event.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground" htmlFor="access-invite-link">提前链接</label>
            <div className="flex gap-2">
              <Input id="access-invite-link" value={link} readOnly className="text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={handleCopy} disabled={!link || loading}>
                复制
              </Button>
            </div>
          </div>
          {message && <p className="break-all text-xs text-muted-foreground">{message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={handleRegenerate} disabled={loading}>
            重生成链接
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={loading}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
