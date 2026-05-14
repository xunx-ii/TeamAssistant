import { getMartialArtLabel, martialArts } from '../data/martialArts'
import type { Slot, TeamConfig } from '../types'

export interface OccupiedSlotDisplay {
  isMine: boolean
  isBoss: boolean
  hasOrangeWeapon: boolean
  className: string
}

export function slotAcceptsSignup(slot: Pick<Slot, 'status'>): boolean {
  return slot.status === 'empty' || slot.status === 'fixed' || slot.status === 'reserved'
}

export function shouldShowAvailableMarker(slot: Pick<Slot, 'status'>, isLocked: boolean): boolean {
  return slotAcceptsSignup(slot) && !isLocked
}

export function canInteractWithSlotLock(isAdmin: boolean, currentQQ: string, lockedBy?: string): boolean {
  return isAdmin || !lockedBy || lockedBy === currentQQ
}

export function getAvailableSlotLabel(isLocked: boolean): string {
  return isLocked ? '⏳ 报名中' : '可选'
}

export function getReservedSlotLabel(isLocked: boolean): string {
  return isLocked ? '⏳ 报名中' : '老板位'
}

export function getFixedSlotLabel(
  slot: Pick<Slot, 'fixedRole' | 'fixedMartialArtIndex'>,
  isLocked: boolean,
): string {
  if (isLocked) return '⏳ 报名中'

  const martialArtIndex = slot.fixedMartialArtIndex
  if (
    martialArtIndex !== null &&
    martialArtIndex >= 0 &&
    martialArtIndex < martialArts.length
  ) {
    return getMartialArtLabel(martialArts[martialArtIndex])
  }

  if (slot.fixedRole === 'T') return '🛡️ T 位'
  if (slot.fixedRole === '治疗') return '💚 奶 位'
  return '⚔️ DPS 位'
}

export function getOccupiedSlotDisplay(
  slot: Slot,
  config: TeamConfig,
  currentQQ: string,
): OccupiedSlotDisplay {
  const isMine = Boolean(currentQQ) && slot.member?.qq === currentQQ
  const isBoss = config.reservedSlots.includes(slot.index)
  const hasOrangeWeapon = Boolean(slot.member?.hasOrangeWeapon)
  const classNames = ['pixel-slot']

  if (isBoss) {
    classNames.push('pixel-slot-boss')
    if (!isMine) classNames.push('opacity-90')
  } else {
    classNames.push(isMine ? 'pixel-slot-mine' : 'pixel-slot-occupied')
  }

  if (isMine) classNames.push('pixel-slot-owned')
  if (hasOrangeWeapon) classNames.push('pixel-slot-cw')

  return {
    isMine,
    isBoss,
    hasOrangeWeapon,
    className: classNames.join(' '),
  }
}
