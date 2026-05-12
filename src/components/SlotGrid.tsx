import { useMemo, useCallback, memo, type ReactNode } from 'react'
import { martialArts, getMartialArtLabel } from '../data/martialArts'
import type { Slot, TeamConfig } from '../types'
import type { SlotLock } from '../api'
import { PixelStar } from './PixelRabbit'
import {
  getAvailableSlotLabel,
  getFixedSlotLabel,
  getOccupiedSlotDisplay,
  getReservedSlotLabel,
  shouldShowAvailableMarker,
} from './slotGridDisplay'

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

  const availableMarker = (className = '') => (
    <span className={`inline-flex items-center justify-center gap-0.5 text-[11px] font-bold leading-none text-pink-500 ${className}`}>
      <PixelStar size={12} className="shrink-0" />
      <span>可选</span>
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
      <div className="grid grid-cols-5 gap-1 sm:gap-2">
        {orderedSlots.map(slot => {
          const isSlotLocked = lockMap.has(slot.index)
          let cellClass = 'relative flex h-[116px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center transition-colors select-none sm:h-[120px] sm:p-2'

          let content: ReactNode

          if (slot.status === 'reserved') {
            cellClass += ' pixel-slot pixel-slot-reserved'
            const label = getReservedSlotLabel(isSlotLocked)
            content = (
              <>
                <span className="absolute top-1 left-1 text-[10px] text-purple-500 font-mono sm:left-2">#{slot.index + 1}</span>
                <span className="max-w-full truncate text-xs text-purple-600 font-medium">{label}</span>
                {shouldShowAvailableMarker(slot, isSlotLocked) && availableMarker('mt-0.5')}
              </>
            )
          } else if (slot.status === 'fixed') {
            cellClass += ' pixel-slot pixel-slot-fixed'
            const fixedLabel = getFixedSlotLabel(slot, isSlotLocked)
            content = (
              <>
                <span className="absolute top-1 left-1 text-[10px] text-teal-500 font-mono sm:left-2">#{slot.index + 1}</span>
                <span className="max-w-full truncate text-xs text-teal-600 font-medium">{fixedLabel}</span>
                {shouldShowAvailableMarker(slot, isSlotLocked) && availableMarker('mt-0.5')}
                {isAdmin && <span className="text-[10px] text-teal-500 mt-0.5">⚙️ 设置</span>}
              </>
            )
          } else if (slot.status === 'occupied' && slot.member) {
            const m = slot.member
            const occupiedDisplay = getOccupiedSlotDisplay(slot, config, currentQQ)
            cellClass += ` ${occupiedDisplay.className}`
            const maIdx = parseInt(m.martialArtIndex)
            const ma = !isNaN(maIdx) && maIdx < martialArts.length ? martialArts[maIdx] : null
            const roleLabel = ma?.role === 'T' ? 'T' : ma?.role === '治疗' ? '奶' : 'DPS'
            const roleColor = ma?.role === 'T' ? 'text-orange-600 bg-orange-100 border-orange-300' :
                              ma?.role === '治疗' ? 'text-pink-600 bg-pink-100 border-pink-300' :
                              'text-blue-600 bg-blue-100 border-blue-300'
            content = (
              <>
                <span className="absolute top-1 left-1 z-[1] text-[10px] text-muted-foreground font-mono sm:left-2">#{slot.index + 1}</span>
                <span className={`absolute top-1 right-1 z-[1] rounded border px-1 py-0.5 text-[10px] font-bold sm:right-2 sm:px-1.5 ${roleColor}`}>
                  {occupiedDisplay.isBoss ? `👑${roleLabel}` : roleLabel}
                </span>
                <div className="relative z-[1] mt-4 flex w-full flex-col items-center px-0.5 sm:mt-3 sm:px-1">
                  <span className={`flex w-full flex-col items-center leading-none text-foreground ${ma ? '' : 'opacity-0'}`}>
                    <span className="max-w-full whitespace-nowrap text-[13px] font-bold leading-[1.1] sm:hidden">
                      {ma ? ma.school : '心法'}
                    </span>
                    <span className="max-w-full whitespace-nowrap text-[10px] font-medium leading-[1.15] sm:hidden">
                      {ma ? ma.name : '占位'}
                    </span>
                    <span className="hidden w-full truncate text-xs font-bold leading-4 sm:block">
                      {ma ? getMartialArtLabel(ma) : '心法占位'}
                    </span>
                  </span>
                  <div className="w-full text-[10px] leading-3 text-muted-foreground sm:text-[11px] sm:leading-4">
                    <span className="sm:hidden">{ma?.role === 'DPS' ? m.gearScore : `${m.gearScore}层`}</span>
                    <span className="hidden sm:inline sm:truncate">{ma?.role === 'DPS' ? `装分：${m.gearScore}` : `层数：${m.gearScore}`}</span>
                  </div>
                  <div className="w-full text-[10px] leading-3 text-muted-foreground sm:text-[11px] sm:leading-4">
                    <span className="sm:hidden">{m.characterId}</span>
                    <span className="hidden sm:inline sm:truncate">ID：{m.characterId}</span>
                  </div>
                  <div className={`w-full text-[9px] leading-3 text-muted-foreground italic sm:text-[10px] sm:leading-4 ${m.note ? '' : 'opacity-0'}`}>
                    {m.note || '备注占位'}
                  </div>
                </div>
              </>
            )
          } else {
            cellClass += ' pixel-slot pixel-slot-available'
            const label = getAvailableSlotLabel(isSlotLocked)
            content = (
              <>
                <span className="absolute top-1 left-1 text-[10px] text-pink-400 font-mono sm:left-2">#{slot.index + 1}</span>
                {shouldShowAvailableMarker(slot, isSlotLocked)
                  ? availableMarker()
                  : <span className="text-xs text-pink-500 font-medium">{label}</span>}
              </>
            )
          }

          return (
            <div
              key={slot.index}
              data-slot-index={slot.index}
              data-slot-status={slot.status}
              className={`${cellClass} overflow-hidden ${isSlotLocked ? 'ring-2 ring-orange-500 border-orange-500' : ''}`}
              onClick={() => handleSlotClick(slot)}
            >
              {content}
              {isSlotLocked && (
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
