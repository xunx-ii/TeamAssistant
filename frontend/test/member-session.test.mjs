import test from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

test('member sessions are QQ-bound, expiration-aware and removable', async () => {
  const original = globalThis.localStorage
  globalThis.localStorage = new MemoryStorage()
  try {
    const mod = await import(`../src/memberSession.ts?case=${Date.now()}`)
    const session = {
      qq: '10001',
      token: 'member-token-abcdefghijklmnopqrstuvwxyz',
      expiresAtMs: Date.now() + 60_000,
      nickname: '张三',
      groupId: '1013228497',
    }
    mod.storeMemberSession(session)
    assert.deepEqual(mod.readMemberSession('10001'), session)
    assert.equal(mod.readMemberSession('20002'), null)

    mod.storeMemberSession({ ...session, qq: '10001', expiresAtMs: Date.now() - 1 })
    assert.equal(mod.readMemberSession('10001'), null)

    mod.storeMemberSession({ ...session, qq: '10001' })
    mod.clearMemberSession()
    assert.equal(mod.readMemberSession('10001'), null)
  } finally {
    globalThis.localStorage = original
  }
})
