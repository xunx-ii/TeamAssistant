import type { ArchivedTeam, Cancellation, OperationLog, SubsidyType, Team, UserProfiles } from './types'
import type { LockToken, Mutation } from './dataStore'

const API = '/api/v2'
const DIRECT_API_PORT = '23219'
const noCache = { cache: 'no-store' as const }
const SERVER_UNAVAILABLE_ERROR = '无法连接到报名服务，请确认后端已启动'
const HTML_RESPONSE_ERROR = '接口返回了页面内容，请确认后端已启动，或已为开发环境配置 /api/v2 代理'
const NON_JSON_RESPONSE_ERROR = '接口返回了非 JSON 响应，请确认后端服务是否正常'
const INVALID_JSON_ERROR = '接口返回的数据无法解析'
const BACKUP_DOWNLOAD_ERROR = '下载备份失败'

export interface ServerData {
  teams: Team[]
  cancellations: Cancellation[]
  archivedTeams: ArchivedTeam[]
  logs: OperationLog[]
  userProfiles: UserProfiles
  isAdmin?: boolean
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
  isAdmin?: boolean
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
  lockVersion?: number
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

export type BackupDownloadResult =
  | { ok: true, blob: Blob, filename: string }
  | RequestFailure

type BodyParseError = typeof HTML_RESPONSE_ERROR | typeof NON_JSON_RESPONSE_ERROR | typeof INVALID_JSON_ERROR

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

function directApiBase() {
  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${DIRECT_API_PORT}${API}`
  }
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const hostname = window.location.hostname || '127.0.0.1'
  return `${protocol}//${hostname}:${DIRECT_API_PORT}${API}`
}

function isApiPath(input: RequestInfo | URL): input is string {
  return typeof input === 'string' && input.startsWith(API)
}

function fallbackApiInput(input: RequestInfo | URL): string | null {
  if (!isApiPath(input)) return null
  return `${directApiBase()}${input.slice(API.length)}`
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<
  | { ok: true, data: T }
  | { ok: false, kind: 'parse' | 'network'; error?: BodyParseError }
> {
  try {
    const resp = await fetch(input, init)
    const parsed = await readJsonBody<T>(resp)
    return parsed.ok ? parsed : { ok: false, kind: 'parse', error: parsed.error as BodyParseError }
  } catch {
    return { ok: false, kind: 'network' }
  }
}

function shouldTryDirectApi(result: { ok: false, kind: 'parse' | 'network'; error?: BodyParseError }) {
  return result.kind === 'network' || result.error === HTML_RESPONSE_ERROR
}

async function requestData<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T | null> {
  const first = await fetchJson<T>(input, init)
  if (first.ok) return first.data

  const fallback = shouldTryDirectApi(first) ? fallbackApiInput(input) : null
  if (!fallback) return null

  const second = await fetchJson<T>(fallback, init)
  return second.ok ? second.data : null
}

async function requestResult<T extends { ok: boolean }>(input: RequestInfo | URL, init?: RequestInit): Promise<T | RequestFailure> {
  const first = await fetchJson<T>(input, init)
  if (first.ok) {
    if (isResultPayload(first.data)) return first.data
    return { ok: false, reason: 'invalidResponse', error: INVALID_JSON_ERROR }
  }

  const fallback = shouldTryDirectApi(first) ? fallbackApiInput(input) : null
  if (fallback) {
    const second = await fetchJson<T>(fallback, init)
    if (second.ok) {
      if (isResultPayload(second.data)) return second.data
      return { ok: false, reason: 'invalidResponse', error: INVALID_JSON_ERROR }
    }
    if (second.kind === 'parse' && second.error) {
      return { ok: false, reason: 'invalidResponse', error: second.error }
    }
  }

  if (first.kind === 'network') {
    return { ok: false, reason: 'network', error: SERVER_UNAVAILABLE_ERROR }
  }
  return { ok: false, reason: 'invalidResponse', error: first.error ?? NON_JSON_RESPONSE_ERROR }
}

async function requestBlob(input: RequestInfo | URL, init?: RequestInit): Promise<BackupDownloadResult> {
  const fetchBlob = async (target: RequestInfo | URL) => {
    const response = await fetch(target, init)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (contentType.includes('text/html')) {
      return { ok: false as const, kind: 'html' as const, error: HTML_RESPONSE_ERROR }
    }
    if (!response.ok) {
      return { ok: false as const, kind: 'status' as const, error: BACKUP_DOWNLOAD_ERROR }
    }
    const blob = await response.blob()
    const disposition = response.headers.get('content-disposition') ?? ''
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? ''
    return { ok: true as const, blob, filename }
  }

  let first: Awaited<ReturnType<typeof fetchBlob>> | { ok: false, kind: 'network' }
  try {
    first = await fetchBlob(input)
  } catch {
    first = { ok: false, kind: 'network' }
  }
  if (first.ok) return first

  const fallback = first.kind === 'network' || first.kind === 'html' ? fallbackApiInput(input) : null
  if (fallback) {
    try {
      const second = await fetchBlob(fallback)
      if (second.ok) return second
      return { ok: false, reason: 'invalidResponse', error: second.error }
    } catch {
      return { ok: false, reason: 'network', error: SERVER_UNAVAILABLE_ERROR }
    }
  }

  if (first.kind === 'network') {
    return { ok: false, reason: 'network', error: SERVER_UNAVAILABLE_ERROR }
  }
  return { ok: false, reason: 'invalidResponse', error: first.error }
}

function encodePath(value: string | number) {
  return encodeURIComponent(String(value))
}

function withActor<T extends object>(body: T, actorQq?: string | null): T & { actorQq?: string } {
  return actorQq ? { ...body, actorQq } : body
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

function routeMutation(mutation: Mutation, actorQq?: string | null): { url: string; init: RequestInit } {
  switch (mutation.type) {
    case 'createTeam':
      return { url: `${API}/teams`, init: jsonRequest('POST', withActor({ team: mutation.team }, actorQq)) }

    case 'deleteTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('DELETE', withActor({ fallbackTeam: mutation.fallbackTeam }, actorQq)),
      }

    case 'archiveTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/archive`,
        init: jsonRequest('POST', withActor({
          archivedBy: mutation.archivedBy,
          archivedAt: mutation.archivedAt,
          fallbackTeam: mutation.fallbackTeam,
        }, actorQq)),
      }

    case 'restoreArchivedTeam':
      return {
        url: `${API}/archives/${encodePath(mutation.archiveId)}/restore`,
        init: jsonRequest('POST', withActor({ actorQq: mutation.actorQq, restoredAt: mutation.restoredAt }, actorQq)),
      }

    case 'renameTeam':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', withActor({ name: mutation.name }, actorQq)),
      }

    case 'updateTeamWeekStart':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', withActor({ weekStart: mutation.weekStart }, actorQq)),
      }

    case 'updateTeamNote':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}`,
        init: jsonRequest('PATCH', withActor({ note: mutation.note }, actorQq)),
      }

    case 'reorderTeams':
      return { url: `${API}/teams/reorder`, init: jsonRequest('POST', withActor({ ids: mutation.ids }, actorQq)) }

    case 'toggleTeamConfigLock':
    case 'setTeamLockState':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/lock-state`,
        init: jsonRequest('PATCH', withActor({ locked: mutation.locked }, actorQq)),
      }

    case 'setSlotRole':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/role`,
        init: jsonRequest('PUT', withActor({
          role: mutation.role,
          martialArtIndex: mutation.martialArtIndex,
          assignQQ: mutation.assignQQ,
          actorQq: mutation.actorQq,
        }, actorQq)),
      }

    case 'quickReserve':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/quick-reserve`,
        init: jsonRequest('POST', withActor({ reserveType: mutation.reserveType, count: mutation.count }, actorQq)),
      }

    case 'signupSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/member`,
        init: jsonRequest('PUT', withActor({
          qq: mutation.member.qq,
          actorQq: mutation.actorQq,
          member: mutation.member,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }, actorQq)),
      }

    case 'cancelSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/cancel`,
        init: jsonRequest('POST', withActor({
          reason: mutation.reason,
          cancelledBy: mutation.cancelledBy,
          timestamp: mutation.timestamp,
          actorQq: mutation.actorQq,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }, actorQq)),
      }

    case 'leaveSlot':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/slots/${encodePath(mutation.slotIndex)}/member`,
        init: jsonRequest('DELETE', withActor({
          actorQq: mutation.actorQq,
          lockToken: mutation.lockTimestamp,
          expectedMemberQq: mutation.expectedMemberQq,
        }, actorQq)),
      }

    case 'dismissCancellation':
      return {
        url: `${API}/cancellations/${encodePath(mutation.qq)}/${encodePath(mutation.timestamp)}`,
        init: jsonRequest('DELETE', withActor({}, actorQq)),
      }

    case 'updateNickname':
      return {
        url: `${API}/user-profiles/${encodePath(mutation.qq)}`,
        init: jsonRequest('PUT', withActor({ nickname: mutation.nickname }, actorQq)),
      }

    case 'updateTeamSubsidyTypes':
      return {
        url: `${API}/teams/${encodePath(mutation.teamId)}/subsidy-types`,
        init: jsonRequest('PUT', withActor({ subsidyTypes: mutation.subsidyTypes }, actorQq)),
      }

    case 'registerMemberSubsidies': {
      const target = mutation.archiveId
        ? `${API}/archives/${encodePath(mutation.archiveId)}/subsidies/${encodePath(mutation.qq)}`
        : `${API}/teams/${encodePath(mutation.teamId ?? '')}/subsidies/${encodePath(mutation.qq)}`
      return {
        url: target,
        init: jsonRequest('PUT', withActor({ selections: mutation.selections, weekStart: mutation.weekStart }, actorQq)),
      }
    }
  }
}

export async function checkServer(): Promise<boolean> {
  const version = await fetchServerVersion()
  return Boolean(version)
}

export async function fetchData(qq?: string | null): Promise<ServerData | null> {
  const params = new URLSearchParams()
  if (qq) params.set('qq', qq)
  const suffix = params.toString() ? `?${params}` : ''
  const data = await requestData<unknown>(`${API}/bootstrap${suffix}`, noCache)
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

export async function fetchServerChanges(dataVersion?: number | null, lockVersion?: number | null, qq?: string | null): Promise<ServerChanges | null> {
  const params = new URLSearchParams()
  if (typeof dataVersion === 'number') params.set('dataVersion', String(dataVersion))
  if (typeof lockVersion === 'number') params.set('lockVersion', String(lockVersion))
  if (qq) params.set('qq', qq)
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
      isAdmin: typeof (payload as { isAdmin?: unknown }).isAdmin === 'boolean' ? (payload as { isAdmin: boolean }).isAdmin : undefined,
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
  const source = new EventSource(`${directApiBase()}/events`)
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
      // Ignore malformed event payloads.
    }
  }
  source.addEventListener('hello', handleMessage)
  source.addEventListener('version', handleMessage)
  source.onerror = () => {
    // EventSource reconnects automatically.
  }
  return () => source.close()
}

export async function pushData(data: Partial<ServerData> & { actorQq?: string | null }): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/data`, jsonRequest('PUT', data))
  return result.ok
}

export async function mutateData(mutation: Mutation, actorQq?: string | null): Promise<MutationResult> {
  const route = routeMutation(mutation, actorQq)
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

export async function releaseSlotLock(teamId: string, slotIndex: number, qq: string, lockTimestamp?: LockToken): Promise<boolean> {
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

export async function lockTeam(teamId: string, actorQq?: string | null): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/team-locks`, jsonRequest('POST', withActor({ teamId }, actorQq)))
  return result.ok
}

export async function unlockTeam(teamId: string, actorQq?: string | null): Promise<boolean> {
  const params = new URLSearchParams()
  if (actorQq) params.set('actorQq', actorQq)
  const suffix = params.toString() ? `?${params}` : ''
  const result = await requestResult<{ ok: boolean }>(
    `${API}/team-locks/${encodePath(teamId)}${suffix}`,
    jsonRequest('DELETE'),
  )
  return result.ok
}

export async function validateLock(teamId: string, slotIndex: number, qq: string, lockTimestamp: LockToken): Promise<ValidateResult> {
  return requestResult<ValidateResult>(
    `${API}/slot-locks/validate`,
    jsonRequest('POST', { teamId, slotIndex, qq, lockToken: lockTimestamp }),
  )
}


export async function fetchSubsidyPresets(): Promise<SubsidyType[] | null> {
  const data = await requestData<{ presets?: SubsidyType[] }>(`${API}/subsidy-presets`, noCache)
  return Array.isArray(data?.presets) ? data.presets : null
}

export async function pushSubsidyPresets(presets: SubsidyType[], actorQq?: string | null): Promise<boolean> {
  const result = await requestResult<{ ok: boolean }>(`${API}/subsidy-presets`, jsonRequest('PUT', withActor({ presets }, actorQq)))
  return result.ok
}
function actorQuery(actorQq?: string | null) {
  const params = new URLSearchParams()
  if (actorQq) params.set('actorQq', actorQq)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function fetchBackups(actorQq?: string | null): Promise<BackupListResult> {
  return requestResult<BackupListResult>(`${API}/backups${actorQuery(actorQq)}`, noCache)
}

export async function createBackup(actorQq?: string | null): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups`, jsonRequest('POST', withActor({}, actorQq)))
}

export async function restoreBackup(name: string, actorQq?: string | null): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/${encodePath(name)}/restore`, jsonRequest('POST', withActor({}, actorQq)))
}

export async function downloadBackup(name: string, actorQq?: string | null): Promise<BackupDownloadResult> {
  const result = await requestBlob(`${API}/backups/${encodePath(name)}/download${actorQuery(actorQq)}`, noCache)
  if (result.ok && !result.filename) {
    return { ...result, filename: name }
  }
  return result
}

export async function deleteBackup(name: string, actorQq?: string | null): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/${encodePath(name)}`, jsonRequest('DELETE', withActor({}, actorQq)))
}

export async function importBackupFile(file: File, actorQq?: string | null): Promise<BackupActionResult> {
  return requestResult<BackupActionResult>(`${API}/backups/import${actorQuery(actorQq)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
}
