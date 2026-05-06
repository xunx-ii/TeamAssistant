export interface Member {
  qq: string
  martialArtIndex: string
  gearScore: string
  characterId: string
  note: string
  hasOrangeWeapon?: boolean
}

export type SlotStatus = 'empty' | 'occupied' | 'reserved' | 'fixed'

export interface Slot {
  index: number
  status: SlotStatus
  member: Member | null
  fixedRole: 'T' | '治疗' | 'DPS' | null
  fixedMartialArtIndex: number | null
}

export interface Cancellation {
  qq: string
  reason: string
  cancelledBy: string
  teamId: string
  teamName: string
  slotIndex: number
  timestamp: number
}

export interface TeamConfig {
  reservedSlots: number[]
  locked: boolean
}

export interface Team {
  id: string
  name: string
  note: string
  config: TeamConfig
  slots: Slot[]
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  reservedSlots: [],
  locked: false,
}

export const TOTAL_SLOTS = 25

export function createEmptySlots(): Slot[] {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
    index: i,
    status: 'empty' as const,
    member: null,
    fixedRole: null,
    fixedMartialArtIndex: null,
  }))
}

let _idCounter = Date.now()
export function generateId(): string {
  return String(++_idCounter)
}
