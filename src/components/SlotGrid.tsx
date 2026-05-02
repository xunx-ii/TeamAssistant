import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Slot, TeamConfig } from '../types'

interface Props {
  slots: Slot[]
  config: TeamConfig
  currentQQ: string
  isAdmin: boolean
  onSignup: (slotIndex: number) => void
  onEdit: (slotIndex: number) => void
  onSetRole: (slotIndex: number) => void
}

function getRoleCounts(slots: Slot[], reservedSlots: number[]) {
  const counts = { T: 0, 治疗: 0, DPS: 0, bossT: 0, bossHealer: 0, bossDPS: 0 }
  for (const slot of slots) {
    if (slot.status === 'occupied' && slot.member) {
      const idx = parseInt(slot.member.martialArtIndex)
      if (!isNaN(idx) && idx < martialArts.length) {
        const r = martialArts[idx].role
        const isBoss = reservedSlots.includes(slot.index)
        if (r === 'T') isBoss ? counts.bossT++ : counts.T++
        else if (r === '治疗') isBoss ? counts.bossHealer++ : counts['治疗']++
        else isBoss ? counts.bossDPS++ : counts.DPS++
      }
    }
    if (slot.status === 'fixed' && slot.fixedRole) {
      if (slot.fixedRole === 'T') counts.T++
      else if (slot.fixedRole === '治疗') counts['治疗']++
      else if (slot.fixedRole === 'DPS') counts.DPS++
    }
  }
  return counts
}

export function SlotGrid({ slots, config, currentQQ, isAdmin, onSignup, onEdit, onSetRole }: Props) {
  const reservedCount = config.reservedSlots.length
  const counts = getRoleCounts(slots, config.reservedSlots)

  const orderedSlots: Slot[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      orderedSlots.push(slots[col * 5 + row])
    }
  }

  const handleSlotClick = (slot: Slot) => {
    if (slot.status === 'occupied' && slot.member) {
      if (slot.member.qq === currentQQ || isAdmin) {
        onEdit(slot.index)
      }
      return
    }
    if (isAdmin && (slot.status === 'empty' || slot.status === 'fixed' || slot.status === 'reserved')) {
      onSetRole(slot.index)
      return
    }
    if (slot.status === 'empty' || slot.status === 'fixed' || slot.status === 'reserved') {
      onSignup(slot.index)
    }
  }

  const statusBadge = (label: string, count: number, color = '') => (
    <span className={`inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium bg-secondary text-secondary-foreground ${color}`}>
      {label} {count}
    </span>
  )

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {statusBadge('T', counts.T)}
        {statusBadge('治疗', counts['治疗'])}
        {statusBadge('DPS', counts.DPS)}
        {statusBadge('老板·T', counts.bossT, 'border-purple-800/50 bg-purple-950/30 text-purple-400')}
        {statusBadge('老板·奶', counts.bossHealer, 'border-purple-800/50 bg-purple-950/30 text-purple-400')}
        {statusBadge('老板·DPS', counts.bossDPS, 'border-purple-800/50 bg-purple-950/30 text-purple-400')}
        {statusBadge('空老板位', reservedCount - counts.bossT - counts.bossHealer - counts.bossDPS)}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {orderedSlots.map(slot => {
          let cellClass = 'relative rounded-lg border text-center cursor-pointer transition-colors flex flex-col items-center justify-center min-h-[72px] p-2 gap-0.5 select-none'

          let content: React.ReactNode

          if (slot.status === 'reserved') {
            cellClass += ' bg-secondary/30 border-border hover:bg-secondary/50'
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-muted-foreground">#{slot.index + 1}</span>
                <span className="text-xs text-muted-foreground">老板位</span>
              </>
            )
          } else if (slot.status === 'fixed') {
            cellClass += ' bg-emerald-950/30 border-emerald-900 hover:bg-emerald-950/50'
            const ma = slot.fixedMartialArtIndex !== null && slot.fixedMartialArtIndex < martialArts.length
              ? martialArts[slot.fixedMartialArtIndex]
              : null
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-emerald-600">#{slot.index + 1}</span>
                <span className="text-xs text-emerald-400 font-medium">
                  {ma ? getMartialArtLabel(ma) : slot.fixedRole === 'T' ? 'T 位' : slot.fixedRole === '治疗' ? '奶 位' : 'DPS 位'}
                </span>
                {isAdmin && <span className="text-[10px] text-emerald-700 mt-0.5">点击设置</span>}
              </>
            )
          } else if (slot.status === 'occupied' && slot.member) {
            const m = slot.member
            const isMine = m.qq === currentQQ
            const isBoss = config.reservedSlots.includes(slot.index)
            if (isBoss) {
              cellClass += isMine
                ? ' bg-purple-950/40 border-purple-800 hover:bg-purple-950/60'
                : ' bg-purple-950/20 border-purple-800/50 hover:bg-purple-950/30'
            } else {
              cellClass += isMine
                ? ' bg-amber-950/30 border-amber-800 hover:bg-amber-950/50'
                : ' bg-blue-950/20 border-blue-900/50 hover:bg-blue-950/30'
            }
            const maIdx = parseInt(m.martialArtIndex)
            const ma = !isNaN(maIdx) && maIdx < martialArts.length ? martialArts[maIdx] : null
            const roleLabel = ma?.role === 'T' ? 'T' : ma?.role === '治疗' ? '奶' : 'DPS'
            const roleColor = ma?.role === 'T' ? 'text-orange-400 bg-orange-950/40 border-orange-800' :
                              ma?.role === '治疗' ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800' :
                              'text-blue-400 bg-blue-950/40 border-blue-800'
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-muted-foreground">#{slot.index + 1}</span>
                <span className={`absolute top-1 right-2 text-[10px] font-medium px-1 rounded border ${roleColor}`}>
                  {isBoss ? `老板·${roleLabel}` : roleLabel}
                </span>
                {ma && <span className="text-xs font-medium text-foreground truncate max-w-full mt-1">{getMartialArtLabel(ma)}</span>}
                <span className="text-[11px] text-muted-foreground">装分：{m.gearScore}</span>
                <span className="text-[11px] text-muted-foreground">ID：{m.characterId}</span>
                {m.note && <span className="text-[10px] text-muted-foreground truncate max-w-full">{m.note}</span>}
              </>
            )
          } else {
            cellClass += ' bg-secondary/10 border-border hover:bg-secondary/20 hover:border-primary/50'
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-muted-foreground">#{slot.index + 1}</span>
                <span className="text-xs text-muted-foreground">可选</span>
              </>
            )
          }

          return (
            <div key={slot.index} className={cellClass} onClick={() => handleSlotClick(slot)}>
              {content}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-secondary/10 border border-border"></span>可选</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-950/20 border border-blue-900/50"></span>已报名</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-950/30 border border-amber-800"></span>我的</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-950/30 border border-emerald-900"></span>固定位</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-950/20 border border-purple-800/50"></span>老板报名</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-secondary/30 border border-border"></span>老板位</span>
      </div>
    </div>
  )
}
