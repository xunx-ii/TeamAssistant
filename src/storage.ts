import type { Team, Cancellation } from './types'

const KEYS = {
  teams: 'team_teams_v3',
  cancellations: 'team_cancellations_v3',
  qq: 'team_qq',
}

export function loadTeams(): Team[] {
  try {
    const raw = localStorage.getItem(KEYS.teams)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

export function saveTeams(teams: Team[]) {
  localStorage.setItem(KEYS.teams, JSON.stringify(teams))
}

export function loadCancellations(): Cancellation[] {
  try {
    const raw = localStorage.getItem(KEYS.cancellations)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

export function saveCancellations(cancellations: Cancellation[]) {
  localStorage.setItem(KEYS.cancellations, JSON.stringify(cancellations))
}

export function getStoredQQ(): string | null {
  return localStorage.getItem(KEYS.qq)
}

export function setStoredQQ(qq: string) {
  localStorage.setItem(KEYS.qq, qq)
}

export function removeStoredQQ() {
  localStorage.removeItem(KEYS.qq)
}
