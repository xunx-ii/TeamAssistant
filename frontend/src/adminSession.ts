export interface AdminSessionState {
  qq: string
  token: string
  expiresAtMs: number
}

const STORAGE_KEY = 'team_admin_session_v2'
const LEGACY_SESSION_KEY = 'team_admin_session_v1'

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function safeGet(storage: Storage | null, key: string) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function safeSet(storage: Storage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function safeRemove(storage: Storage | null, key: string) {
  try {
    storage?.removeItem(key)
  } catch {
    // Best-effort cleanup only.
  }
}

function parseSession(raw: string | null, qq: string): AdminSessionState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AdminSessionState>
    if (
      parsed.qq === qq &&
      typeof parsed.token === 'string' &&
      parsed.token &&
      typeof parsed.expiresAtMs === 'number' &&
      Number.isSafeInteger(parsed.expiresAtMs) &&
      parsed.expiresAtMs > 0
    ) {
      return parsed as AdminSessionState
    }
  } catch {
    // Ignore malformed session state.
  }
  return null
}

export function readStoredAdminSession(qq: string | null): AdminSessionState | null {
  if (!qq) return null
  const local = getLocalStorage()
  const session = getSessionStorage()

  if (local) {
    const stored = parseSession(safeGet(local, STORAGE_KEY), qq)
    if (stored) return stored
    safeRemove(local, STORAGE_KEY)
  }

  const legacy = parseSession(safeGet(session, LEGACY_SESSION_KEY), qq)
  if (!legacy) {
    safeRemove(session, LEGACY_SESSION_KEY)
    return null
  }
  safeSet(local, STORAGE_KEY, JSON.stringify(legacy))
  safeRemove(session, LEGACY_SESSION_KEY)
  return legacy
}

export function storeAdminSession(adminSession: AdminSessionState) {
  safeSet(getLocalStorage(), STORAGE_KEY, JSON.stringify(adminSession))
  safeRemove(getSessionStorage(), LEGACY_SESSION_KEY)
}

export function clearStoredAdminSession() {
  safeRemove(getLocalStorage(), STORAGE_KEY)
  const session = getSessionStorage()
  safeRemove(session, STORAGE_KEY)
  safeRemove(session, LEGACY_SESSION_KEY)
}
