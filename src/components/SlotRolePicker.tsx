import { useState } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import { ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'

interface Props {
  open: boolean
  slotIndex: number
  currentRole: 'T' | '治疗' | 'DPS' | null
  currentMartialArt: number | null
  isReserved: boolean
  canSignup: boolean
  onSet: (role: 'T' | '治疗' | 'DPS' | 'boss' | null, martialArtIndex: number | null, assignQQ?: string) => void
  onSignup: () => void
  onClose: () => void
}

export function SlotRolePicker({ open, slotIndex, currentRole, currentMartialArt, isReserved, canSignup, onSet, onSignup, onClose }: Props) {
  const [showMartialArts, setShowMartialArts] = useState(false)
  const [assignQQ, setAssignQQ] = useState('')

  const handlePick = (role: 'T' | '治疗' | 'DPS' | 'boss' | null, maIdx: number | null = null) => {
    const qq = normalizeTextInput(assignQQ, { maxLength: TEXT_INPUT_LIMITS.qq }) || undefined
    onSet(role, maIdx, qq)
  }

  const hasRestriction = !!currentRole || currentMartialArt !== null || isReserved

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>位置 #{slotIndex + 1}</DialogTitle>
        </DialogHeader>

        {!showMartialArts ? (
          <div className="flex flex-col gap-2">
            {!isReserved && (
              <Button variant="outline" className="justify-start h-10" onClick={() => handlePick('boss')}>
                老板位
              </Button>
            )}
            <Button variant="outline" className="justify-start h-10 hover:bg-blue-950/30 hover:border-blue-800" onClick={() => handlePick('T')}>
              固定 T 位
            </Button>
            <Button variant="outline" className="justify-start h-10 hover:bg-emerald-950/30 hover:border-emerald-800" onClick={() => handlePick('治疗')}>
              固定 奶 位
            </Button>
            <Button variant="outline" className="justify-start h-10 hover:bg-purple-950/30 hover:border-purple-800" onClick={() => setShowMartialArts(true)}>
              指定心法...
            </Button>
            {hasRestriction && (
              <Button variant="outline" className="justify-start h-10 text-destructive hover:bg-destructive/10" onClick={() => handlePick(null, null)}>
                {isReserved ? '取消老板位' : '清除限制'}
              </Button>
            )}
            {canSignup && (
              <Button className="justify-start h-10 mt-1" onClick={onSignup}>
                报名此位
              </Button>
            )}
          </div>
        ) : (
          <div>
            <button className="flex items-center gap-1 text-sm text-primary hover:underline mb-3" onClick={() => setShowMartialArts(false)}>
              <ArrowLeft className="h-3 w-3" /> 返回
            </button>
            <div className="space-y-1.5 mb-3">
              <span className="text-xs text-muted-foreground">指定QQ（可选，填写后直接占位）</span>
              <Input
                className="h-8 text-sm"
                placeholder="输入QQ号直接占位"
                value={assignQQ}
                maxLength={TEXT_INPUT_LIMITS.qq}
                onChange={e => setAssignQQ(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.qq }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-1 max-h-72 overflow-y-auto">
              {martialArts.map((ma, i) => (
                <button
                  key={i}
                  className={`text-left text-xs px-2 py-1.5 rounded border transition-colors truncate ${
                    currentMartialArt === i
                      ? 'bg-primary/20 border-primary text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent'
                  }`}
                  onClick={() => handlePick(ma.role, i)}
                >
                  {getMartialArtLabel(ma)}
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
