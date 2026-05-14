import type { ArchivedTeam, Cancellation, OperationLog, SubsidyType, Team, UserProfiles } from './types'
import type { Mutation } from './dataStore'

const API = '/api'
const noCache = { cache: 'no-store' as const }
const SERVER_UNAVAILABLE_ERROR = '无法连接到报名服务，请确认后端已启动'
const HTML_RESPONSE_ERROR = '接口返回了页面内容，请确认后端已启动，或已为开发环境配置 /api 代理'
const NON_JSON_RESPONSE_ERROR = '接口返回了非 JSON 响应，请确认后端服务是否正常'
const INVALID_JSON_ERROR = '接口返回的数据无法解析'

export interface ServerData {
  teams: Team[]
  cancellations: Cancellation[]
  archivedTeams: ArchivedTeam[]
  logs: OperationLog[]
  userProfiles: UserProfiles
  subsidyPresets?: SubsidyType[]
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

export interface LockState {
  slots: SlotLock[]
  teams: TeamLockInfo[]
}

export interface AcquireResult {
  ok: boolean
  lockedBy?: string
  lockedAt?: number
  reason?: string
  timestamp?: number
  error?: string
}

export interface ValidateResult {
  ok: boolean
  reason?: string
  lockedAt?: number
  error?: string
}

export interface MutationResult {
  ok: boolean
  data?: ServerData
  reason?: string
  lockedAt?: number
  currentMemberQq?: string | null
  error?: string
}

export interface BackupEntry {
  name: string
  createdAt: string
  size: number
}

export interface BackupListResult {
  ok: boolean
  backups?: BackupEntry[]
  error?: string
}

export interface BackupActionResult {
  ok: boolean
  name?: string | null
  backups?: BackupEntry[]
  data?: ServerData
  error?: string
}

type RequestFailure = {
  ok: false
  reason: 'network' | 'invalidResponse'
  error: string
}

function isServerData(value: unknown): value is ServerData {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as Partial<ServerData>).teams) &&
    Array.isArray((value as Partial<ServerData>).cancellations),
  )
}

function isResultPayload(value: unknown): value is { ok: boolean } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'ok' in value &&
    typeof (value as { ok?: unknown }).ok === 'boolean',
  )
}

async function readJsonBody<T>(resp: Response): Promise<{ ok: true, data: T } | { ok: false, error: string }> {
  const contentType = resp.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('json')) {
    const text = await resp.text().catch(() => '')
    const error = /<!doctype html|<html/i.test(text) ? HTML_RESPONSE_ERROR : NON_JSON_RESPONSE_ERROR
    return { ok: false, error }
  }

  try {
    return { ok: true, data: await resp.json() as T }
  } catch {
    return { ok: false, error: INVALID_JSON_ERROR }
  }
}

async function requestData<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T | null> {
  try {
    const resp = await fetch(input, init)
    if (!resp.ok) return null
    const parsed = await readJsonBody<T>(resp)
    return parsed.ok ? parsed.data : null
  } catch {
    return null
  }
}

async function requestResult<T extends { ok: boolean }>(input: RequestInfo | URL, init?: RequestInit): Promise<T | RequestFailure> {
  try {
    const resp = await fetch(input, init)
    const parsed = await readJsonBody<T>(resp)
    if (!parsed.ok) {
      return { ok: false, reason: 'invalidResponse', error: parsed.error }
    }
    if (!isResultPayload(parsed.data)) {
      return { ok: false, reason: 'invalidResponse', error: INVALID_JSON_ERROR }
    }
    return parsed.data
  } catch {
    return { ok: false, reason: 'network', error: SERVER_UNAVAILABLE_ERROR }
  }
}

export async function checkServer(): Promise<boolean> {
  const data = await requestData<unknown>(`${API}/data`, noCache)
  return isServerData(data)
}

export async function fetchData(): Promise<ServerData | null> {
  const data = await requestData<unknown>(`${API}/data`, noCache)
  return isServerData(data) ? data : null
}

export async function pushData(data: Partial<ServerData>): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return result.ok
}

export async function mutateData(mutation: Mutation): Promise<MutationResult> {
  return requestResult<MutationResult>(`${API}/mutate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutation }),
  })
}

export async function acquireSlotLock(teamId: string, slotIndex: number, qq: string): Promise<AcquireResult> {
  return requestResult<AcquireResult>(`${API}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, slotIndex, qq }),
  })
}

export async function releaseSlotLock(teamId: string, slotIndex: number, qq: string, lockTimestamp?: number): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/lock`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, slotIndex, qq, lockTimestamp }),
  })
  return result.ok
}

export async function fetchLocks(): Promise<SlotLock[]> {
  return (await fetchLockState()).slots
}

export async function fetchTeamLocks(): Promise<TeamLockInfo[]> {
  return (await fetchLockState()).teams
}

export async function fetchLockState(): Promise<LockState> {
  return (await fetchLockStateOrNull()) ?? { slots: [], teams: [] }
}

export async function fetchLockStateOrNull(): Promise<LockState | null> {
  const data = await requestData<{ slots?: SlotLock[], teams?: TeamLockInfo[] }>(`${API}/locks`, noCache)
  if (!data) return null
  return {
    slots: Array.isArray(data?.slots) ? data.slots : [],
    teams: Array.isArray(data?.teams) ? data.teams : [],
  }
}

export async function lockTeam(teamId: string): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/team-lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId }),
  })
  return result.ok
}

export async function unlockTeam(teamId: string): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/team-lock`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId }),
  })
  return result.ok
}

export async function validateLock(teamId: string, slotIndex: number, qq: string, lockTimestamp: number): Promise<ValidateResult> {
  return requestResult<ValidateResult>(`${API}/validate-lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId, slotIndex, qq, lockTimestamp }),
  })
}


export async function fetchSubsidyPresets(): Promise<SubsidyType[] | null> {
  const data = await requestData<{ presets?: SubsidyType[] }>(`${API}/subsidy-presets`, noCache)
  return Array.isArray(data?.presets) ? data.presets : null
}

export async function pushSubsidyPresets(presets: SubsidyType[]): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/subsidy-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presets }),
  })
  return result.ok
}
export async function fetchBackups(): Promise<BackupListResult> {
  return requestResult<BackupListResult>(`${API}/backups`, noCache)
}

export async function createBackup(): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups`, {
    method: 'POST',
  })
}

export async function restoreBackup(name: string): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteBackup(name: string): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function importBackupFile(file: File): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
}
