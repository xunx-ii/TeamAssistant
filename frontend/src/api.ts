import type { ArchivedTeam, Cancellation, OperationLog, SubsidyType, Team, UserProfiles } from './types'
import type { Mutation } from './dataStore'

const API = '/api/v2'
const noCache = { cache: 'no-store' as const }
const SERVER_UNAVAILABLE_ERROR = '无法连接到报名服务，请确认后端已启动'
const HTML_RESPONSE_ERROR = '接口返回了页面内容，请确认后端已启动，或已为开发环境配置 /api/v2 代理'
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
  teamLocks?: TeamLockInfo[]
  dataVersion?: number
  lockVersion?: number
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
  lockVersion?: number
}

export interface ServerVersion {
  ok: boolean
  dataVersion: number
  lockVersion: number
}

export interface ServerChanges {
  ok: boolean
  dataVersion: number
  lockVersion: number
  dataChanged: boolean
  lockChanged: boolean
  data?: ServerData
  locks?: LockState
}

export interface ServerEvent {
  ok?: boolean
  type?: string
  dataVersion: number
  lockVersion: number
}

export interface AcquireResult {
  ok: boolean
  lockedBy?: string
  lockedAt?: number
  reason?: string
  timestamp?: number
  lockToken?: number | string
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
  dataVersion?: number
  lockVersion?: number
  patch?: unknown
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

function encodePath(value: string | number) {
  return encodeURIComponent(String(value))
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

function routeMutation(mutation: Mutation): { url: string; init: RequestInit } {
  switch (mutation.type) {
    case 'createTeam':
      return { url: `${API}/teams`, init: jsonRequest('POST', { team: mutation.team }) }

    case 'deleteTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('DELETE', { fallbackTeam: mutation.fallbackTeam }),
      }

    case 'archiveTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/archive`,
        init: jsonRequest('POST', {
          archivedBy: mutation.archivedBy,
          archivedAt: mutation.archivedAt,
          fallbackTeam: mutation.fallbackTeam,
        }),
      }

    case 'restoreArchivedTeam':
      return {
        url: `${API}/archives/${encodePath(mutation.archiveId)}/restore`,
        init: jsonRequest('POST', { actorQq: mutation.actorQq, restoredAt: mutation.restoredAt }),
      }

    case 'renameTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', { name: mutation.name }),
      }

    case 'updateTeamWeekStart':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', { weekStart: mutation.weekStart }),
      }

    case 'updateTeamNote':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', { note: mutation.note }),
      }

    case 'reorderTeams':
      return { url: `${API}/teams/reorder`, init: jsonRequest('POST', { ids: mutation.ids }) }

    case 'toggleTeamConfigLock':
    case 'setTeamLockState':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/lock-state`,
        init: jsonRequest('PATCH', { locked: mutation.locked }),
      }

    case 'setSlotRole':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/role`,
        init: jsonRequest('PUT', {
          role: mutation.role,
          martialArtIndex: mutation.martialArtIndex,
          assignQQ: mutation.assignQQ,
          actorQq: mutation.actorQq,
        }),
      }

    case 'quickReserve':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/quick-reserve`,
        init: jsonRequest('POST', { reserveType: mutation.reserveType, count: mutation.count }),
      }

    case 'signupSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/member`,
        init: jsonRequest('PUT', {
          qq: mutation.member.qq,
          actorQq: mutation.actorQq,
          member: mutation.member,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }),
      }

    case 'cancelSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/cancel`,
        init: jsonRequest('POST', {
          reason: mutation.reason,
          cancelledBy: mutation.cancelledBy,
          timestamp: mutation.timestamp,
          actorQq: mutation.actorQq,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }),
      }

    case 'leaveSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/member`,
        init: jsonRequest('DELETE', {
          actorQq: mutation.actorQq,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }),
      }

    case 'dismissCancellation':
      return {
        url: `${API}/cancellations/${encodePath(mutation.qq)}/${encodePath(mutation.timestamp)}`,
        init: jsonRequest('DELETE'),
      }

    case 'updateNickname':
      return {
        url: `${API}/user-profiles/${encodePath(mutation.qq)}`,
        init: jsonRequest('PUT', { nickname: mutation.nickname }),
      }

    case 'updateTeamSubsidyTypes':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/subsidy-types`,
        init: jsonRequest('PUT', { subsidyTypes: mutation.subsidyTypes }),
      }

    case 'registerMemberSubsidies': {
      const target = mutation.archiveId
        ? `${API}/archives/${encodePath(mutation.archiveId)}/subsidies/${encodePath(mutation.qq)}`
        : `${API}/teams/${encodePath(mutation.teamId ?? '')}/subsidies/${encodePath(mutation.qq)}`
      return {
        url: target,
        init: jsonRequest('PUT', { selections: mutation.selections, weekStart: mutation.weekStart }),
      }
    }
  }
}

export async function checkServer(): Promise<boolean> {
  const version = await fetchServerVersion()
  return Boolean(version)
}

export async function fetchData(): Promise<ServerData | null> {
  const data = await requestData<unknown>(`${API}/bootstrap`, noCache)
  return isServerData(data) ? data : null
}

export async function fetchServerVersion(): Promise<ServerVersion | null> {
  const data = await requestData<unknown>(`${API}/version`, noCache)
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as Partial<ServerVersion>).dataVersion === 'number' &&
    typeof (data as Partial<ServerVersion>).lockVersion === 'number'
  ) {
    return {
      ok: (data as Partial<ServerVersion>).ok !== false,
      dataVersion: (data as ServerVersion).dataVersion,
      lockVersion: (data as ServerVersion).lockVersion,
    }
  }
  return null
}

export async function fetchServerChanges(dataVersion?: number | null, lockVersion?: number | null): Promise<ServerChanges | null> {
  const params = new URLSearchParams()
  if (typeof dataVersion === 'number') params.set('dataVersion', String(dataVersion))
  if (typeof lockVersion === 'number') params.set('lockVersion', String(lockVersion))
  const suffix = params.toString() ? `?${params}` : ''
  const data = await requestData<unknown>(`${API}/sync${suffix}`, noCache)
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as Partial<ServerChanges>).dataVersion === 'number' &&
    typeof (data as Partial<ServerChanges>).lockVersion === 'number'
  ) {
    const payload = data as Partial<ServerChanges>
    const nextDataVersion = payload.dataVersion
    const nextLockVersion = payload.lockVersion
    if (typeof nextDataVersion !== 'number' || typeof nextLockVersion !== 'number') return null
    const locks = payload.locks
    return {
      ok: payload.ok !== false,
      dataVersion: nextDataVersion,
      lockVersion: nextLockVersion,
      dataChanged: Boolean(payload.dataChanged),
      lockChanged: Boolean(payload.lockChanged),
      data: isServerData(payload.data) ? payload.data : undefined,
      locks: locks && typeof locks === 'object'
        ? {
            slots: Array.isArray(locks.slots) ? locks.slots : [],
            teams: Array.isArray(locks.teams) ? locks.teams : [],
            lockVersion: typeof locks.lockVersion === 'number' ? locks.lockVersion : undefined,
          }
        : undefined,
    }
  }
  return null
}

export function subscribeServerEvents(onEvent: (event: ServerEvent) => void): (() => void) | null {
  if (typeof EventSource === 'undefined') return null
  const source = new EventSource(`${API}/events`)
  const handleMessage = (message: MessageEvent) => {
    try {
      const parsed = JSON.parse(message.data) as Partial<ServerEvent>
      if (typeof parsed.dataVersion === 'number' && typeof parsed.lockVersion === 'number') {
        onEvent({
          ok: parsed.ok,
          type: parsed.type,
          dataVersion: parsed.dataVersion,
          lockVersion: parsed.lockVersion,
        })
      }
    } catch {
      // Ignore malformed event payloads; polling remains as fallback.
    }
  }
  source.addEventListener('hello', handleMessage)
  source.addEventListener('version', handleMessage)
  source.onerror = () => {
    // EventSource reconnects automatically; adaptive polling is the safety net.
  }
  return () => source.close()
}

export async function pushData(data: Partial<ServerData>): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/data`, jsonRequest('PUT', data))
  return result.ok
}

export async function mutateData(mutation: Mutation): Promise<MutationResult> {
  const route = routeMutation(mutation)
  return requestResult<MutationResult>(route.url, route.init)
}

export async function acquireSlotLock(teamId: string, slotIndex: number, qq: string): Promise<AcquireResult> {
  const result = await requestResult<AcquireResult>(`${API}/slot-locks`, jsonRequest('POST', { teamId, slotIndex, qq }))
  if (result.ok && result.lockToken != null && result.timestamp == null) {
    const numericToken = Number(result.lockToken)
    return { ...result, timestamp: Number.isFinite(numericToken) ? numericToken : Date.now() }
  }
  return result
}

export async function releaseSlotLock(teamId: string, slotIndex: number, qq: string, lockTimestamp?: number): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(
    `${API}/slot-locks/${encodePath(teamId)}/${encodePath(slotIndex)}`,
    jsonRequest('DELETE', { qq, lockToken: lockTimestamp }),
  )
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
  const data = await requestData<{ slots?: SlotLock[], teams?: TeamLockInfo[], lockVersion?: number }>(`${API}/locks`, noCache)
  if (!data) return null
  return {
    slots: Array.isArray(data?.slots) ? data.slots : [],
    teams: Array.isArray(data?.teams) ? data.teams : [],
    lockVersion: typeof data.lockVersion === 'number' ? data.lockVersion : undefined,
  }
}

export async function lockTeam(teamId: string): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/team-locks`, jsonRequest('POST', { teamId }))
  return result.ok
}

export async function unlockTeam(teamId: string): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(
    `${API}/team-locks/${encodePath(teamId)}`,
    jsonRequest('DELETE'),
  )
  return result.ok
}

export async function validateLock(teamId: string, slotIndex: number, qq: string, lockTimestamp: number): Promise<ValidateResult> {
  return requestResult<ValidateResult>(
    `${API}/slot-locks/validate`,
    jsonRequest('POST', { teamId, slotIndex, qq, lockToken: lockTimestamp }),
  )
}


export async function fetchSubsidyPresets(): Promise<SubsidyType[] | null> {
  const data = await requestData<{ presets?: SubsidyType[] }>(`${API}/subsidy-presets`, noCache)
  return Array.isArray(data?.presets) ? data.presets : null
}

export async function pushSubsidyPresets(presets: SubsidyType[]): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/subsidy-presets`, jsonRequest('PUT', { presets }))
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
  return requestResult<BackupActionResult>(`${API}/backups/${encodePath(name)}/restore`, jsonRequest('POST'))
}

export async function deleteBackup(name: string): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/${encodePath(name)}`, jsonRequest('DELETE'))
}

export async function importBackupFile(file: File): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
}
