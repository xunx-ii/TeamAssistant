import type { ArchivedTeam, Cancellation, OperationLog, Team, UserProfiles } from './types'
import { checkServer, fetchServerChanges, pushData, type ServerData } from './api'
import { normalizeHydratableData, normalizeHydratableTeams } from './dataHydration'

const KEYS = {
  teams: 'team_teams_v3',
  cancellations: 'team_cancellations_v3',
  archivedTeams: 'team_archived_teams_v1',
  logs: 'team_operation_logs_v1',
  userProfiles: 'team_user_profiles_v1',
  qq: 'team_qq',
}

let serverMode = false

function reportLocalStorageCorruption(key: string, raw: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const quarantineKey = `${key}__corrupt__${Date.now()}`
  try {
    localStorage.setItem(quarantineKey, raw)
    localStorage.removeItem(key)
  } catch {
    // ignore quota/security failures and keep best-effort warning
  }
  console.warn(`[storage] localStorage payload for ${key} is invalid JSON and has been quarantined as ${quarantineKey}: ${message}`)
}

function loadJsonArray<T>(key: string, normalize: (value: unknown) => T[]): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return normalize(parsed)
  } catch (error) {
    const raw = localStorage.getItem(key)
    if (raw) reportLocalStorageCorruption(key, raw, error)
    return []
  }
}

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
  return loadJsonArray(KEYS.teams, value => normalizeHydratableTeams(value))
}
function loadCancellationsLocal(): Cancellation[] {
  return loadJsonArray(KEYS.cancellations, value => normalizeHydratableData({ cancellations: value }).cancellations)
}
function loadArchivedTeamsLocal(): ArchivedTeam[] {
  return loadJsonArray(KEYS.archivedTeams, value => normalizeHydratableData({ archivedTeams: value }).archivedTeams)
}
function loadLogsLocal(): OperationLog[] {
  return loadJsonArray(KEYS.logs, value => normalizeHydratableData({ logs: value }).logs)
}
function loadUserProfilesLocal(): UserProfiles {
  try {
    const raw = localStorage.getItem(KEYS.userProfiles)
    if (!raw) return {}
    return normalizeHydratableData({ userProfiles: JSON.parse(raw) }).userProfiles
  } catch (error) {
    const raw = localStorage.getItem(KEYS.userProfiles)
    if (raw) reportLocalStorageCorruption(KEYS.userProfiles, raw, error)
    return {}
  }
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
      userProfiles: loadUserProfilesLocal(),
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
      userProfiles: loadUserProfilesLocal(),
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

export function loadUserProfiles(): UserProfiles {
  return loadUserProfilesLocal()
}

export function setUserProfilesLocal(userProfiles: UserProfiles) {
  localStorage.setItem(KEYS.userProfiles, JSON.stringify(userProfiles))
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
    const changes = await fetchServerChanges()
    const data = changes?.data ?? null
    if (!data) return 'unavailable'
    const snapshot = normalizeServerData(data)
    if (snapshot.teams.length === 0) return 'empty'
    setTeamsLocal(snapshot.teams)
    setCancellationsLocal(snapshot.cancellations)
    setArchivedTeamsLocal(snapshot.archivedTeams)
    setOperationLogsLocal(snapshot.logs)
    setUserProfilesLocal(snapshot.userProfiles)
    return 'loaded'
  } catch {
    return 'unavailable'
  }
}
