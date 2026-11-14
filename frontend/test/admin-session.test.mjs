import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearStoredAdminSession,
  readStoredAdminSession,
  storeAdminSession,
} from '../src/adminSession.ts'

class MemoryStorage {
  values = new Map()

  get length() {
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }
}

test('admin sessions are shared across tabs, tolerate client clock skew and migrate legacy storage', () => {
  const originalLocalStorage = globalThis.localStorage
  const originalSessionStorage = globalThis.sessionStorage
  const local = new MemoryStorage()
  const tab = new MemoryStorage()
  globalThis.localStorage = local
  globalThis.sessionStorage = tab

  try {
    const now = Date.now()
    const session = { qq: '313389778', token: 'token-a', expiresAtMs: now + 60_000 }
    storeAdminSession(session)
    assert.deepEqual(readStoredAdminSession('313389778'), session)
    assert.equal(tab.getItem('team_admin_session_v1'), null)

    tab.setItem('team_admin_session_v1', JSON.stringify({ ...session, token: 'legacy-token' }))
    local.clear()
    assert.equal(readStoredAdminSession('313389778')?.token, 'legacy-token')
    assert.equal(tab.getItem('team_admin_session_v1'), null)
    assert.equal(JSON.parse(local.getItem('team_admin_session_v2')).token, 'legacy-token')

    local.setItem('team_admin_session_v2', JSON.stringify({ ...session, expiresAtMs: now - 1 }))
    assert.equal(readStoredAdminSession('313389778')?.token, 'token-a')
    assert.equal(local.getItem('team_admin_session_v2') !== null, true)

    local.setItem('team_admin_session_v2', JSON.stringify({ ...session, expiresAtMs: 'invalid' }))
    assert.equal(readStoredAdminSession('313389778'), null)
    assert.equal(local.getItem('team_admin_session_v2'), null)

    storeAdminSession(session)
    clearStoredAdminSession()
    assert.equal(readStoredAdminSession('313389778'), null)
  } finally {
    globalThis.localStorage = originalLocalStorage
    globalThis.sessionStorage = originalSessionStorage
  }
})
