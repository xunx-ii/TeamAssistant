const API = '/api'
const noCache = { cache: 'no-store' as const }

export interface ServerData {
  teams: any[]
  cancellations: any[]
  locks?: SlotLock[]
}

export interface SlotLock {
  teamId: string
  slotIndex: number
  qq: string
  timestamp: number
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

export async function acquireSlotLock(teamId: string, slotIndex: number, qq: string): Promise<{ ok: boolean; lockedBy?: string }> {
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
    if (resp.ok) return await resp.json()
  } catch { /* */ }
  return []
}
