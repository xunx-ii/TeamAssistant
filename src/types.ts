export interface Member {
  qq: string
  martialArtIndex: string
  gearScore: string
  characterId: string
  note: string
  hasOrangeWeapon?: boolean
}

export interface SubsidyLevel {
  name: string
  gold: number
}

export interface SubsidyType {
  id: string
  name: string
  levels: SubsidyLevel[]
}

export interface MemberSubsidySelection {
  typeId: string
  levelName: string
  weekStart?: string
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
  subsidyTypes?: SubsidyType[]
  memberSubsidies?: Record<string, MemberSubsidySelection[]>
}

export interface ArchivedTeam {
  id: string
  team: Team
  archivedAt: number
  archivedBy: string
}

export interface OperationLog {
  id: string
  teamId: string
  teamName: string
  timestamp: number
  actorQq: string
  action: string
}

export interface SubsidyTarget {
  id: string
  name: string
  weekStart: string
  currentSelections: MemberSubsidySelection[]
  teamId?: string
  archiveId?: string
  archivedAt?: number
  subsidyTypes: SubsidyType[]
  memberSubsidies: Record<string, MemberSubsidySelection[]>
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
