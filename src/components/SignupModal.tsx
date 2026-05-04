import { useState, useMemo, useEffect, useRef } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Member, Slot } from '../types'
import { acquireSlotLock, releaseSlotLock, validateLock } from '../api'
import { ChevronsUpDown, Search, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface Props {
  open: boolean
  qq: string
  lockOwnerQq?: string
  existing?: Member
  isAdminEditing: boolean
  slotInfo?: Slot | null
  isBossSlot?: boolean
  teamId?: string
  takenMartialArts: number[]
  readOnly?: boolean
  onConfirm: (data: Omit<Member, 'qq'>, lockTimestamp?: number) => void
  onClose: () => void
  onLeave?: (lockTimestamp?: number) => void
  onCancelMember?: () => void
}

export function SignupModal({ open, qq, lockOwnerQq, existing, isAdminEditing, slotInfo, isBossSlot, teamId, takenMartialArts, readOnly = false, onConfirm, onClose, onLeave, onCancelMember }: Props) {
  const [martialArt, setMartialArt] = useState(existing?.martialArtIndex ?? '')
  const [gearScore, setGearScore] = useState(existing?.gearScore ?? '')
  const [characterId, setCharacterId] = useState(existing?.characterId ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [lockTimestamp, setLockTimestamp] = useState<number>(0)
  const [error, setError] = useState('')
  const [maSearch, setMaSearch] = useState('')
  const [showMaDropdown, setShowMaDropdown] = useState(false)
  const heartbeatRef = useRef<number>(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const gearScoreRef = useRef<HTMLInputElement>(null)
  const lockQq = lockOwnerQq ?? qq
  const slotIndex = slotInfo?.index ?? null

  const selectedMa = martialArt ? martialArts[parseInt(martialArt)] : null
  const isDPS = selectedMa?.role === 'DPS'

  // Lock management
  useEffect(() => {
    if (!open || !teamId || slotIndex == null || readOnly) return
    const lock = async () => {
      const result = await acquireSlotLock(teamId, slotIndex, lockQq)
      if (result.ok && result.timestamp) {
        setLockTimestamp(result.timestamp)
        setError('')
      } else if (result.reason === 'teamLocked') {
        setError('表格已被管理员锁定')
      } else if (result.lockedBy && result.lockedBy !== qq) {
        setError(`该位置已被 ${result.lockedBy} 先点击`)
      }
    }
    void lock()
    heartbeatRef.current = setInterval(lock, 15000)
    return () => {
      clearInterval(heartbeatRef.current)
      void releaseSlotLock(teamId, slotIndex, lockQq)
    }
  }, [open, teamId, slotIndex, lockQq, qq, readOnly])

  const handleClose = () => {
    if (teamId && slotIndex != null) void releaseSlotLock(teamId, slotIndex, lockQq)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!martialArt || !characterId) return
    if (isDPS && !gearScore) return
    setError('')
    if (teamId && slotInfo != null && lockTimestamp > 0) {
      const validation = await validateLock(teamId, slotInfo.index, lockQq, lockTimestamp)
      if (!validation.ok) {
        if (validation.reason === 'teamLocked') setError('表格已被管理员锁定，无法保存')
        else setError('该位置已被其他人抢占，请重新选择')
        return
      }
    }
    const maIdx = parseInt(martialArt)
    const ma = martialArts[maIdx]
    if (ma && (ma.role === 'T' || ma.role === '治疗') && !existing && !isBossSlot) {
      if (takenMartialArts.includes(maIdx)) {
        setError(`${ma.school}·${ma.name} 已有他人报名`)
        return
      }
    }
    onConfirm({ martialArtIndex: martialArt, gearScore, characterId, note }, lockTimestamp)
  }

  // Filter martial arts by search
  const allowedMartialArts = useMemo(() => {
    let list = martialArts
    if (slotInfo && slotInfo.status === 'fixed') {
      if (slotInfo.fixedMartialArtIndex !== null) {
        list = [martialArts[slotInfo.fixedMartialArtIndex]].filter(Boolean)
      } else if (slotInfo.fixedRole) {
        list = martialArts.filter(ma => ma.role === slotInfo.fixedRole)
      }
    }
    if (!maSearch.trim()) return list
    const q = maSearch.trim().toLowerCase()
    return list.filter(ma => {
      const label = getMartialArtLabel(ma).toLowerCase()
      return label.includes(q) || ma.school.toLowerCase().includes(q) || ma.name.toLowerCase().includes(q)
    })
  }, [slotInfo, maSearch])

  useEffect(() => {
    if (!showMaDropdown) return
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMaDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMaDropdown])

  const selectMartialArt = (idx: number) => {
    setMartialArt(String(idx))
    setMaSearch('')
    setShowMaDropdown(false)
  }

  const title = readOnly ? '查看报名' : isAdminEditing ? '编辑成员' : existing ? '修改报名' : '报名'
  const isFixedSlot = slotInfo?.status === 'fixed' && !existing
  const showActions = !readOnly

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          if (existing) {
            event.preventDefault()
            gearScoreRef.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {isBossSlot && (
          <p className="text-xs text-purple-400 bg-purple-950/30 rounded-md px-3 py-2">此位置为老板位</p>
        )}
        {isFixedSlot && (
          <p className="text-xs text-emerald-400 bg-emerald-950/30 rounded-md px-3 py-2">
            {slotInfo?.fixedMartialArtIndex !== null
              ? `限定心法：${getMartialArtLabel(martialArts[slotInfo!.fixedMartialArtIndex!])}`
              : `限定：${slotInfo?.fixedRole === 'T' ? 'T' : slotInfo?.fixedRole === '治疗' ? '治疗' : 'DPS'}`}
          </p>
        )}
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>QQ</Label>
            <Input value={qq} disabled />
          </div>
          <div className="space-y-1.5 relative" ref={dropdownRef}>
            <Label>心法</Label>
            <div
              className={`rounded-md border bg-background shadow-sm transition-colors ${showMaDropdown ? 'border-ring ring-1 ring-ring' : 'border-input'}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  placeholder={martialArt ? getMartialArtLabel(martialArts[parseInt(martialArt)]) : '搜索心法'}
                  value={martialArt ? getMartialArtLabel(martialArts[parseInt(martialArt)]) : maSearch}
                  onChange={e => {
                    if (readOnly) return
                    setMartialArt('')
                    setMaSearch(e.target.value)
                    setShowMaDropdown(true)
                  }}
                  onFocus={() => {
                    if (readOnly) return
                    if (!martialArt) setShowMaDropdown(true)
                  }}
                  readOnly={!!martialArt || readOnly}
                  disabled={readOnly}
                />
                {martialArt ? (
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      if (readOnly) return
                      setMartialArt('')
                      setMaSearch('')
                      setShowMaDropdown(true)
                    }}
                    aria-label="清空心法"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => {
                      if (readOnly) return
                      setShowMaDropdown(v => !v)
                    }}
                    aria-label="展开心法列表"
                  >
                    <ChevronsUpDown className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            {showMaDropdown && (
              <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
                {allowedMartialArts.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">无匹配心法</p>
                ) : (
                  <div className="max-h-60 overflow-y-auto py-1">
                    {allowedMartialArts.map(ma => {
                      const idx = martialArts.indexOf(ma)
                      const selected = String(idx) === martialArt
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                            selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
                          }`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => selectMartialArt(idx)}
                        >
                          <span className={`inline-flex min-w-9 items-center justify-center rounded-sm px-2 py-0.5 text-[11px] font-medium ${
                            ma.role === 'T'
                              ? 'bg-orange-950/25 text-orange-500'
                              : ma.role === '治疗'
                                ? 'bg-emerald-950/25 text-emerald-500'
                                : 'bg-blue-950/25 text-blue-500'
                          }`}>
                            {ma.role === 'T' ? 'T' : ma.role === '治疗' ? '奶' : 'DPS'}
                          </span>
                          <span className="truncate text-foreground">{getMartialArtLabel(ma)}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{isDPS ? '装分' : '层数'}</Label>
              <Input
                ref={gearScoreRef}
                type="number"
                value={gearScore}
                onChange={e => { if (!readOnly) setGearScore(e.target.value) }}
                placeholder={isDPS ? '装分' : '层数'}
                disabled={readOnly}
              />
          </div>
          <div className="space-y-1.5">
            <Label>角色ID</Label>
            <Input value={characterId} onChange={e => { if (!readOnly) setCharacterId(e.target.value) }} placeholder="角色ID" disabled={readOnly} />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={note} onChange={e => { if (!readOnly) setNote(e.target.value) }} placeholder="备注" disabled={readOnly} />
          </div>
          {showActions && (
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1">{existing ? '保存修改' : '确认报名'}</Button>
              {onLeave && (
                <Button type="button" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onLeave(lockTimestamp)}>
                  退出报名
                </Button>
              )}
              {onCancelMember && (
                <Button type="button" variant="destructive" className="flex-1" onClick={onCancelMember}>
                  取消该成员
                </Button>
              )}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
