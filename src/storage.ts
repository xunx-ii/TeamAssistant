import type { Team, Cancellation } from './types'
import { checkServer, fetchData, pushData } from './api'

const KEYS = {
  teams: 'team_teams_v3',
  cancellations: 'team_cancellations_v3',
  qq: 'team_qq',
}

let serverMode = false

export async function initServerMode(): Promise<boolean> {
  serverMode = await checkServer()
  return serverMode
}

// localStorage read helpers
function loadTeamsLocal(): Team[] {
  try {
    const raw = localStorage.getItem(KEYS.teams)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}
function loadCancellationsLocal(): Cancellation[] {
  try {
    const raw = localStorage.getItem(KEYS.cancellations)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

// Public API
export function loadTeams(): Team[] {
  return loadTeamsLocal()
}

export async function saveTeams(teams: Team[]) {
  localStorage.setItem(KEYS.teams, JSON.stringify(teams))
  if (serverMode) {
    await pushData({ teams, cancellations: loadCancellationsLocal() })
  }
}

export function loadCancellations(): Cancellation[] {
  return loadCancellationsLocal()
}

export async function saveCancellations(cancellations: Cancellation[]) {
  localStorage.setItem(KEYS.cancellations, JSON.stringify(cancellations))
  if (serverMode) {
    await pushData({ teams: loadTeamsLocal(), cancellations })
  }
}

// QQ is local-only (per browser), not synced to server
export function getStoredQQ(): string | null {
  return localStorage.getItem(KEYS.qq)
}

export function setStoredQQ(qq: string) {
  localStorage.setItem(KEYS.qq, qq)
}

export function removeStoredQQ() {
  localStorage.removeItem(KEYS.qq)
}

export async function loadFromServer(): Promise<boolean> {
  if (!serverMode) return false
  try {
    const data = await fetchData()
    if (!data) return false
    if (data.teams && data.teams.length > 0) {
      localStorage.setItem(KEYS.teams, JSON.stringify(data.teams))
    }
    if (data.cancellations && data.cancellations.length > 0) {
      localStorage.setItem(KEYS.cancellations, JSON.stringify(data.cancellations))
    }
    return true
  } catch {
    return false
  }
}
