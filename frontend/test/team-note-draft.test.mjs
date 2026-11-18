import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearTeamNoteDraft,
  loadTeamNoteDraft,
  saveTeamNoteDraft,
} from '../src/teamNoteDraft.ts'

class MemoryStorage {
  values = new Map()

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

test('team note drafts survive navigation and only clear the expected value', () => {
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = new MemoryStorage()
  try {
    saveTeamNoteDraft('team-1', '10001', '尚未保存的备注')
    assert.equal(loadTeamNoteDraft('team-1', '10001'), '尚未保存的备注')
    assert.equal(loadTeamNoteDraft('team-2', '10001'), null)
    assert.equal(loadTeamNoteDraft('team-1', '10002'), null)

    clearTeamNoteDraft('team-1', '10001', '旧内容')
    assert.equal(loadTeamNoteDraft('team-1', '10001'), '尚未保存的备注')

    clearTeamNoteDraft('team-1', '10001', '尚未保存的备注')
    assert.equal(loadTeamNoteDraft('team-1', '10001'), null)
  } finally {
    globalThis.localStorage = originalLocalStorage
  }
})
