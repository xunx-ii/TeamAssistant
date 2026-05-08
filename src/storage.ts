import type { ArchivedTeam, Cancellation, OperationLog, Team } from './types'
import { checkServer, fetchData, pushData, type ServerData } from './api'
import { normalizeHydratableData, normalizeHydratableTeams } from './dataHydration'

const KEYS = {
  teams: 'team_teams_v3',
  cancellations: 'team_cancellations_v3',
  archivedTeams: 'team_archived_teams_v1',
  logs: 'team_operation_logs_v1',
  qq: 'team_qq',
}

let serverMode = false

export type LoadFromServerResult = 'loaded' | 'empty' | 'unavailable'

export async function initServerMode(): Promise<boolean> {
  serverMode = await checkServer()
  return serverMode
}

export function hasHydratableTeams(data: Pick<ServerData, 'teams'> | null | undefined): data is ServerData {
  return normalizeHydratableData(data).teams.length > 0
}

// localStorage read helpers
function loadTeamsLocal(): Team[] {
  try {
    const raw = localStorage.getItem(KEYS.teams)
    if (raw) return normalizeHydratableTeams(JSON.parse(raw))
  } catch { /* ignore */ }
  return []
}
function loadCancellationsLocal(): Cancellation[] {
  try {
    const raw = localStorage.getItem(KEYS.cancellations)
    if (raw) return normalizeHydratableData({ cancellations: JSON.parse(raw) }).cancellations
  } catch { /* ignore */ }
  return []
}
function loadArchivedTeamsLocal(): ArchivedTeam[] {
  try {
    const raw = localStorage.getItem(KEYS.archivedTeams)
    if (raw) return normalizeHydratableData({ archivedTeams: JSON.parse(raw) }).archivedTeams
  } catch { /* ignore */ }
  return []
}
function loadLogsLocal(): OperationLog[] {
  try {
    const raw = localStorage.getItem(KEYS.logs)
    if (raw) return normalizeHydratableData({ logs: JSON.parse(raw) }).logs
  } catch { /* ignore */ }
  return []
}

// Public API
export function loadTeams(): Team[] {
  return loadTeamsLocal()
}

export function setTeamsLocal(teams: Team[]) {
  localStorage.setItem(KEYS.teams, JSON.stringify(teams))
}

export async function saveTeams(teams: Team[]) {
  setTeamsLocal(teams)
  if (serverMode) {
    await pushData({
      teams,
      cancellations: loadCancellationsLocal(),
      archivedTeams: loadArchivedTeamsLocal(),
      logs: loadLogsLocal(),
    })
  }
}

export function loadCancellations(): Cancellation[] {
  return loadCancellationsLocal()
}

export function setCancellationsLocal(cancellations: Cancellation[]) {
  localStorage.setItem(KEYS.cancellations, JSON.stringify(cancellations))
}

export async function saveCancellations(cancellations: Cancellation[]) {
  setCancellationsLocal(cancellations)
  if (serverMode) {
    await pushData({
      teams: loadTeamsLocal(),
      cancellations,
      archivedTeams: loadArchivedTeamsLocal(),
      logs: loadLogsLocal(),
    })
  }
}

export function loadArchivedTeams(): ArchivedTeam[] {
  return loadArchivedTeamsLocal()
}

export function setArchivedTeamsLocal(archivedTeams: ArchivedTeam[]) {
  localStorage.setItem(KEYS.archivedTeams, JSON.stringify(archivedTeams))
}

export function loadOperationLogs(): OperationLog[] {
  return loadLogsLocal()
}

export function setOperationLogsLocal(logs: OperationLog[]) {
  localStorage.setItem(KEYS.logs, JSON.stringify(logs))
}

export function normalizeServerData(data: ServerData): ServerData {
  return normalizeHydratableData(data)
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

export async function loadFromServer(): Promise<LoadFromServerResult> {
  if (!serverMode) return 'unavailable'
  try {
    const data = await fetchData()
    if (!data) return 'unavailable'
    const snapshot = normalizeServerData(data)
    if (snapshot.teams.length === 0) return 'empty'
    setTeamsLocal(snapshot.teams)
    setCancellationsLocal(snapshot.cancellations)
    setArchivedTeamsLocal(snapshot.archivedTeams)
    setOperationLogsLocal(snapshot.logs)
    return 'loaded'
  } catch {
    return 'unavailable'
  }
}
