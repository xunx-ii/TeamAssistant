import { useMemo, useCallback, memo } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Slot, TeamConfig } from '../types'
import type { SlotLock } from '../api'

interface Props {
  slots: Slot[]
  config: TeamConfig
  currentQQ: string
  isAdmin: boolean
  locks: SlotLock[]
  teamLocked: boolean
  onSignup: (slotIndex: number) => void
  onEdit: (slotIndex: number) => void
  onSetRole: (slotIndex: number) => void
  onView: (slotIndex: number) => void
}

function getRoleCounts(slots: Slot[], reservedSlots: number[]) {
  const counts = { T: 0, 治疗: 0, DPS: 0, bossT: 0, bossHealer: 0, bossDPS: 0 }
  for (const slot of slots) {
    if (slot.status === 'occupied' && slot.member) {
        const idx = parseInt(slot.member.martialArtIndex)
        if (!isNaN(idx) && idx < martialArts.length) {
          const r = martialArts[idx].role
          const isBoss = reservedSlots.includes(slot.index)
          if (r === 'T') {
            if (isBoss) counts.bossT += 1
            else counts.T += 1
          } else if (r === '治疗') {
            if (isBoss) counts.bossHealer += 1
            else counts['治疗'] += 1
          } else if (isBoss) {
            counts.bossDPS += 1
          } else {
            counts.DPS += 1
          }
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

export const SlotGrid = memo(function SlotGrid({ slots, config, currentQQ, isAdmin, locks, teamLocked, onSignup, onEdit, onSetRole, onView }: Props) {
  const counts = getRoleCounts(slots, config.reservedSlots)

  const lockMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const lock of locks) {
      map.set(lock.slotIndex, lock.qq)
    }
    return map
  }, [locks])

  const orderedSlots = useMemo(() => {
    const result: Slot[] = []
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        result.push(slots[col * 5 + row])
      }
    }
    return result
  }, [slots])

  const handleSlotClick = useCallback((slot: Slot) => {
    // Team locked via config or real-time server: only admin can interact
    if ((config.locked || teamLocked) && !isAdmin) return

    if (slot.status === 'occupied' && slot.member) {
      if (slot.member.qq === currentQQ || isAdmin) {
        onEdit(slot.index)
      } else {
        onView(slot.index)
      }
      return
    }
    if (isAdmin && (slot.status === 'empty' || slot.status === 'fixed' || slot.status === 'reserved')) {
      onSetRole(slot.index)
      return
    }
    if (!isAdmin && lockMap.has(slot.index)) {
      return
    }
    if (slot.status === 'empty' || slot.status === 'fixed' || slot.status === 'reserved') {
      onSignup(slot.index)
    }
  }, [currentQQ, isAdmin, onEdit, onSetRole, onSignup, onView, lockMap, config.locked, teamLocked])

  const lockedCount = lockMap.size

  const statusBadge = (emoji: string, label: string, count: number, color = '') => (
    <span className={`inline-flex items-center gap-1 pixel-badge bg-secondary text-secondary-foreground ${color}`}>
      <span className="leading-none">{emoji}</span>
      <span className="leading-none">{label}</span>
      <span className="leading-none font-bold">{count}</span>
    </span>
  )

  const legendItem = (swatchClass: string, label: string) => (
    <span className="flex items-center gap-1">
      <span className={`pixel-slot-legend ${swatchClass}`}></span>
      {label}
    </span>
  )

  return (
    <div>
      {(config.locked || teamLocked) && !isAdmin && (
        <div className="mb-3 pixel-notification bg-red-50 px-3 py-2 text-xs text-red-600">
          🔒 表格已锁定，仅管理员可编辑
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-3">
        {statusBadge('🛡️', 'T', counts.T)}
        {statusBadge('💚', '治疗', counts['治疗'])}
        {statusBadge('⚔️', 'DPS', counts.DPS)}
        {statusBadge('老板', 'T', counts.bossT, 'bg-purple-100 text-purple-700')}
        {statusBadge('老板', '奶', counts.bossHealer, 'bg-purple-100 text-purple-700')}
        {statusBadge('老板', 'DPS', counts.bossDPS, 'bg-purple-100 text-purple-700')}
        {lockedCount > 0 && (
          <span className="pixel-badge bg-orange-100 text-orange-700">
            ✏️ {lockedCount}
          </span>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {orderedSlots.map(slot => {
          let cellClass = 'relative flex h-[120px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-center transition-colors select-none'

          let content: React.ReactNode

          if (slot.status === 'reserved') {
            cellClass += ' pixel-slot pixel-slot-reserved'
            const label = lockMap.has(slot.index) ? '⏳ 报名中' : '🐰 老板位'
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-purple-500 font-mono">#{slot.index + 1}</span>
                <span className="text-xs text-purple-600 font-medium">{label}</span>
              </>
            )
          } else if (slot.status === 'fixed') {
            cellClass += ' pixel-slot pixel-slot-fixed'
            const ma = slot.fixedMartialArtIndex !== null && slot.fixedMartialArtIndex < martialArts.length
              ? martialArts[slot.fixedMartialArtIndex]
              : null
            const fixedLabel = lockMap.has(slot.index) ? '⏳ 报名中' :
              (ma ? getMartialArtLabel(ma) : slot.fixedRole === 'T' ? '🛡️ T 位' : slot.fixedRole === '治疗' ? '💚 奶 位' : '⚔️ DPS 位')
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-teal-500 font-mono">#{slot.index + 1}</span>
                <span className="text-xs text-teal-600 font-medium">{fixedLabel}</span>
                {isAdmin && <span className="text-[10px] text-teal-500 mt-0.5">⚙️ 设置</span>}
              </>
            )
          } else if (slot.status === 'occupied' && slot.member) {
            const m = slot.member
            const isMine = m.qq === currentQQ
            const isBoss = config.reservedSlots.includes(slot.index)
            const hasOrangeWeapon = Boolean(m.hasOrangeWeapon)
            if (isBoss) {
              cellClass += isMine
                ? ' pixel-slot pixel-slot-boss'
                : ' pixel-slot pixel-slot-boss opacity-90'
            } else {
              cellClass += isMine
                ? ' pixel-slot pixel-slot-mine'
                : ' pixel-slot pixel-slot-occupied'
            }
            if (hasOrangeWeapon) {
              cellClass += ' pixel-slot-cw'
            }
            const maIdx = parseInt(m.martialArtIndex)
            const ma = !isNaN(maIdx) && maIdx < martialArts.length ? martialArts[maIdx] : null
            const roleLabel = ma?.role === 'T' ? 'T' : ma?.role === '治疗' ? '奶' : 'DPS'
            const roleColor = ma?.role === 'T' ? 'text-orange-600 bg-orange-100 border-orange-300' :
                              ma?.role === '治疗' ? 'text-emerald-600 bg-emerald-100 border-emerald-300' :
                              'text-blue-600 bg-blue-100 border-blue-300'
            content = (
              <>
                <span className="absolute top-1 left-2 z-[1] text-[10px] text-muted-foreground font-mono">#{slot.index + 1}</span>
                <span className={`absolute top-1 right-2 z-[1] text-[10px] font-bold px-1.5 py-0.5 rounded border ${roleColor}`}>
                  {isBoss ? `👑${roleLabel}` : roleLabel}
                </span>
                <div className="relative z-[1] mt-3 flex w-full flex-col items-center px-1">
                  <span className={`w-full truncate text-xs font-bold leading-4 text-foreground ${ma ? '' : 'opacity-0'}`}>
                    {ma ? getMartialArtLabel(ma) : '心法占位'}
                  </span>
                  <span className="w-full truncate text-[11px] leading-4 text-muted-foreground">
                    {ma?.role === 'DPS' ? `装分：${m.gearScore}` : `层数：${m.gearScore}`}
                  </span>
                  <span className="w-full truncate text-[11px] leading-4 text-muted-foreground">ID：{m.characterId}</span>
                  <span className={`w-full truncate text-[10px] leading-4 text-muted-foreground italic ${m.note ? '' : 'opacity-0'}`}>
                    {m.note || '备注占位'}
                  </span>
                </div>
              </>
            )
          } else {
            cellClass += ' pixel-slot pixel-slot-available'
            const label = lockMap.has(slot.index) ? '⏳ 报名中' : '✨ 可选'
            content = (
              <>
                <span className="absolute top-1 left-2 text-[10px] text-pink-400 font-mono">#{slot.index + 1}</span>
                <span className="text-xs text-pink-500 font-medium">{label}</span>
              </>
            )
          }

          return (
            <div
              key={slot.index}
              className={`${cellClass} overflow-hidden ${lockMap.has(slot.index) ? 'ring-2 ring-orange-500 border-orange-500' : ''}`}
              onClick={() => handleSlotClick(slot)}
            >
              {content}
              {lockMap.has(slot.index) && (
                <div className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-orange-600 text-white py-0.5 font-medium z-10">
                  {lockMap.get(slot.index)} 编辑中
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-muted-foreground">
        {legendItem('pixel-slot-legend-available', '可选')}
        {legendItem('pixel-slot-legend-occupied', '已报名')}
        {legendItem('pixel-slot-legend-mine', '我的')}
        {legendItem('pixel-slot-legend-fixed', '固定位')}
        {legendItem('pixel-slot-legend-boss', '老板报名')}
        {legendItem('pixel-slot-legend-reserved', '老板位')}
        {lockedCount > 0 && (
          <span className="flex items-center gap-1"><span className="pixel-slot-legend pixel-slot-legend-editing"></span>编辑中</span>
        )}
      </div>
    </div>
  )
})
