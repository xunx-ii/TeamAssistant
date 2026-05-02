import { useState, useMemo } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Member, Slot } from '../types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface Props {
  open: boolean
  qq: string
  existing?: Member
  isAdminEditing: boolean
  slotInfo?: Slot | null
  isBossSlot?: boolean
  onConfirm: (data: Omit<Member, 'qq'>) => void
  onClose: () => void
  onLeave?: () => void
  onCancelMember?: () => void
}

export function SignupModal({ open, qq, existing, isAdminEditing, slotInfo, isBossSlot, onConfirm, onClose, onLeave, onCancelMember }: Props) {
  const [martialArt, setMartialArt] = useState(existing?.martialArtIndex ?? '')
  const [gearScore, setGearScore] = useState(existing?.gearScore ?? '')
  const [characterId, setCharacterId] = useState(existing?.characterId ?? '')
  const [note, setNote] = useState(existing?.note ?? '')

  const allowedMartialArts = useMemo(() => {
    if (!slotInfo || slotInfo.status !== 'fixed') return martialArts
    if (slotInfo.fixedMartialArtIndex !== null) {
      const ma = martialArts[slotInfo.fixedMartialArtIndex]
      return ma ? [ma] : martialArts
    }
    if (slotInfo.fixedRole) {
      return martialArts.filter(ma => ma.role === slotInfo.fixedRole)
    }
    return martialArts
  }, [slotInfo])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!martialArt || !gearScore || !characterId) return
    onConfirm({ martialArtIndex: martialArt, gearScore, characterId, note })
  }

  const title = isAdminEditing ? '编辑成员' : existing ? '修改报名' : '报名'
  const isFixedSlot = slotInfo?.status === 'fixed' && !existing

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {isBossSlot && (
          <p className="text-xs text-purple-400 bg-purple-950/30 rounded-md px-3 py-2">
            此位置为老板位
          </p>
        )}
        {isFixedSlot && (
          <p className="text-xs text-emerald-400 bg-emerald-950/30 rounded-md px-3 py-2">
            {slotInfo?.fixedMartialArtIndex !== null
              ? `限定心法：${getMartialArtLabel(martialArts[slotInfo!.fixedMartialArtIndex!])}`
              : `限定：${slotInfo?.fixedRole === 'T' ? 'T' : slotInfo?.fixedRole === '治疗' ? '治疗' : 'DPS'}`}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>QQ</Label>
            <Input value={qq} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>心法</Label>
            <Select value={martialArt} onValueChange={setMartialArt}>
              <SelectTrigger>
                <SelectValue placeholder="选择心法" />
              </SelectTrigger>
              <SelectContent>
                {allowedMartialArts.map(ma => {
                  const idx = martialArts.indexOf(ma)
                  return <SelectItem key={idx} value={String(idx)}>{getMartialArtLabel(ma)}</SelectItem>
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>装分</Label>
            <Input type="number" value={gearScore} onChange={e => setGearScore(e.target.value)} placeholder="装分" />
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
              <Button type="button" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={onLeave}>
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
