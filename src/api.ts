import type { Cancellation, Team } from './types'
import type { Mutation } from './dataStore'

const API = '/api'
const noCache = { cache: 'no-store' as const }

export interface ServerData {
  teams: Team[]
  cancellations: Cancellation[]
  locks?: SlotLock[]
}

export interface SlotLock {
  teamId: string
  slotIndex: number
  qq: string
  timestamp: number
}

export interface TeamLockInfo {
  teamId: string
  timestamp: number
}

export interface AcquireResult {
  ok: boolean
  lockedBy?: string
  lockedAt?: number
  reason?: string
  timestamp?: number
}

export interface ValidateResult {
  ok: boolean
  reason?: string
  lockedAt?: number
}

export interface MutationResult {
  ok: boolean
  data?: ServerData
  reason?: string
  lockedAt?: number
  currentMemberQq?: string | null
  error?: string
}

let serverAvailable = false
let checked = false

export async function checkServer(): Promise<boolean> {
  if (checked) return serverAvailable
  try {
    const resp = await fetch(`${API}/data`, noCache)
    serverAvailable = resp.ok
  } catch {
    serverAvailable = false
  }
  checked = true
  return serverAvailable
}

export async function fetchData(): Promise<ServerData | null> {
  try {
    const resp = await fetch(`${API}/data`, noCache)
    if (resp.ok) return await resp.json()
  } catch { /* */ }
  return null
}

export async function pushData(data: Partial<ServerData>): Promise<boolean> {
  try {
    const resp = await fetch(`${API}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return resp.ok
  } catch {
    return false
  }
}

export async function mutateData(mutation: Mutation): Promise<MutationResult> {
  try {
    const resp = await fetch(`${API}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutation }),
    })
    return await resp.json()
  } catch {
    return { ok: false, reason: 'network', error: 'Network error' }
  }
}

export async function acquireSlotLock(teamId: string, slotIndex: number, qq: string): Promise<AcquireResult> {
  try {
    const resp = await fetch(`${API}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, slotIndex, qq }),
    })
    return await resp.json()
  } catch {
    return { ok: false }
  }
}

export async function releaseSlotLock(teamId: string, slotIndex: number, qq: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API}/lock`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, slotIndex, qq }),
    })
    return resp.ok
  } catch {
    return false
  }
}

export async function fetchLocks(): Promise<SlotLock[]> {
  try {
    const resp = await fetch(`${API}/locks`, noCache)
    if (resp.ok) {
      const data = await resp.json()
      return data.slots || []
    }
  } catch { /* */ }
  return []
}

export async function fetchTeamLocks(): Promise<TeamLockInfo[]> {
  try {
    const resp = await fetch(`${API}/locks`, noCache)
    if (resp.ok) {
      const data = await resp.json()
      return data.teams || []
    }
  } catch { /* */ }
  return []
}

export async function lockTeam(teamId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API}/team-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    })
    return resp.ok
  } catch { return false }
}

export async function unlockTeam(teamId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API}/team-lock`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    })
    return resp.ok
  } catch { return false }
}

export async function validateLock(teamId: string, slotIndex: number, qq: string, lockTimestamp: number): Promise<ValidateResult> {
  try {
    const resp = await fetch(`${API}/validate-lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, slotIndex, qq, lockTimestamp }),
    })
    return await resp.json()
  } catch {
    return { ok: false, reason: 'network' }
  }
}
