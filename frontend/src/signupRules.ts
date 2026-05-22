import { martialArts, type MartialArt } from './data/martialArts'
import type { Slot } from './types'

export interface MartialArtOption {
  index: number
  martialArt: MartialArt
}

export function findUniqueSignupConflictSlot(slots: Slot[], qq: string | null | undefined, currentSlotIndex: number) {
  if (!qq) return null
  return slots.find(slot => slot.index !== currentSlotIndex && slot.member?.qq === qq) ?? null
}

export function isTnRole(role: MartialArt['role'] | null | undefined) {
  return role === 'T' || role === '治疗'
}

export function getSlotRoleMartialArtOptions(onlyTnSignup: boolean): MartialArtOption[] {
  return martialArts
    .map((martialArt, index) => ({ martialArt, index }))
    .filter(option => !onlyTnSignup || isTnRole(option.martialArt.role))
}
