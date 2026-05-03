import { useState, useMemo, useEffect, useRef } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Member, Slot } from '../types'
import { acquireSlotLock, releaseSlotLock, validateLock } from '../api'
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
  onConfirm: (data: Omit<Member, 'qq'>, lockTimestamp?: number) => void
  onClose: () => void
  onLeave?: (lockTimestamp?: number) => void
  onCancelMember?: () => void
}

export function SignupModal({ open, qq, lockOwnerQq, existing, isAdminEditing, slotInfo, isBossSlot, teamId, takenMartialArts, onConfirm, onClose, onLeave, onCancelMember }: Props) {
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
  const lockQq = lockOwnerQq ?? qq

  const selectedMa = martialArt ? martialArts[parseInt(martialArt)] : null
  const isDPS = selectedMa?.role === 'DPS'

  // Lock management
  useEffect(() => {
    if (!open || !teamId || slotInfo == null) return
    const slotIndex = slotInfo.index
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
  }, [open, teamId, slotInfo, lockQq, qq])

  const handleClose = () => {
    if (teamId && slotInfo != null) void releaseSlotLock(teamId, slotInfo.index, lockQq)
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

  const selectMartialArt = (idx: number) => {
    setMartialArt(String(idx))
    setMaSearch('')
    setShowMaDropdown(false)
  }

  const title = isAdminEditing ? '编辑成员' : existing ? '修改报名' : '报名'
  const isFixedSlot = slotInfo?.status === 'fixed' && !existing

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-sm">
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
            <div className="relative">
              <Input
                placeholder={martialArt ? getMartialArtLabel(martialArts[parseInt(martialArt)]) : '搜索心法...'}
                value={martialArt ? '' : maSearch}
                onChange={e => { setMaSearch(e.target.value); setShowMaDropdown(true) }}
                onFocus={() => setShowMaDropdown(true)}
                onBlur={() => setTimeout(() => setShowMaDropdown(false), 150)}
                readOnly={!!martialArt}
              />
              {martialArt && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                  onClick={() => { setMartialArt(''); setMaSearch(''); setShowMaDropdown(false) }}
                >
                  ×
                </button>
              )}
            </div>
            {showMaDropdown && (
              <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
                {allowedMartialArts.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">无匹配心法</p>
                ) : (
                  allowedMartialArts.map(ma => {
                    const idx = martialArts.indexOf(ma)
                    return (
                      <div
                        key={idx}
                        className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-accent ${String(idx) === martialArt ? 'bg-accent' : ''}`}
                        onClick={() => selectMartialArt(idx)}
                      >
                        <span className="text-xs text-muted-foreground mr-2">
                          {ma.role === 'T' ? 'T' : ma.role === '治疗' ? '奶' : 'DPS'}
                        </span>
                        {getMartialArtLabel(ma)}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{isDPS ? '装分' : '层数'}</Label>
            <Input
              type="number"
              value={gearScore}
              onChange={e => setGearScore(e.target.value)}
              placeholder={isDPS ? '装分' : '层数'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>角色ID</Label>
            <Input value={characterId} onChange={e => setCharacterId(e.target.value)} placeholder="角色ID" />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="备注" />
          </div>
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
        </form>
      </DialogContent>
    </Dialog>
  )
}
