import type { ArchivedTeam, Cancellation, OperationLog, Team, UserProfiles } from './types'
import { checkServer, fetchServerChanges, pushData, type ServerChanges, type ServerData } from './api'
import { normalizeHydratableData, normalizeHydratableTeams } from './dataHydration'
import { CANCELLATION_WINDOW, LOG_WINDOW, trimRecentByTimestamp } from './historyWindow'

const KEYS = {
  teams: 'team_teams_v3',
  cancellations: 'team_cancellations_v3',
  archivedTeams: 'team_archived_teams_v1',
  logs: 'team_operation_logs_v1',
  userProfiles: 'team_user_profiles_v1',
  qq: 'team_qq',
}

// 与后端 bootstrap 截断窗口保持一致：cancellations 200 / logs 500，
// 避免本地 localStorage 在长期使用中无限增长，重新 hydrate 后又把这些
// 旧数据塞回前端造成内存膨胀。这里只截断写入侧，读出来的旧数据如果
// 仍然超过上限，下一次 saveTeams / serverPatch 时会被自然修剪。
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

// 首次同步同时确认服务可用性，避免先探测 /version 再串行获取数据。
export async function initializeServerData(qq: string, signal?: AbortSignal): Promise<ServerChanges | null> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = globalThis.setTimeout(abort, 10_000)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  try {
    const changes = await fetchServerChanges(null, null, qq, controller.signal)
    // 被替换的初始化不能改变当前会话的连接状态。
    if (signal?.aborted) return null
    const ready = changes?.ok === true && Boolean(changes.data)
    serverMode = ready
    return ready ? changes : null
  } finally {
    globalThis.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
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
      actorQq: getStoredQQ(),
    })
  }
}

export function loadCancellations(): Cancellation[] {
  return loadCancellationsLocal()
}

export function setCancellationsLocal(cancellations: Cancellation[]) {
  const trimmed = trimRecentByTimestamp(cancellations, CANCELLATION_WINDOW)
  localStorage.setItem(KEYS.cancellations, JSON.stringify(trimmed))
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
      actorQq: getStoredQQ(),
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
  const trimmed = trimRecentByTimestamp(logs, LOG_WINDOW)
  localStorage.setItem(KEYS.logs, JSON.stringify(trimmed))
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
