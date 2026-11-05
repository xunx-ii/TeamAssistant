import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldApplySyncVersion, planMutationSync, unseenServerPatches } from '../src/syncCursor.ts'

test('a delayed sync response cannot roll back newer data', () => {
  assert.equal(shouldApplySyncVersion(8, 5, 6), false)
  assert.equal(shouldApplySyncVersion(8, 5, 9), true)
})

test('sync accepts a server version reset when no newer response has been applied', () => {
  assert.equal(shouldApplySyncVersion(8, 8, 1), true)
  assert.equal(shouldApplySyncVersion(null, null, 1), true)
})

test('mutation version gaps retain the cursor so concurrent writes are fetched', () => {
  assert.deepEqual(planMutationSync(5, 8), { apply: true, nextVersion: 5, needsSync: true })
  assert.deepEqual(planMutationSync(5, 6), { apply: true, nextVersion: 6, needsSync: false })
  assert.deepEqual(planMutationSync(null, 8), { apply: true, nextVersion: null, needsSync: true })
})

test('mutation responses already included by sync are not applied twice', () => {
  assert.deepEqual(planMutationSync(8, 7), { apply: false, nextVersion: 8, needsSync: false })
  assert.deepEqual(planMutationSync(8, 8), { apply: false, nextVersion: 8, needsSync: false })
})

test('sync skips older patches that would overwrite a newer member', () => {
  const patches = [6, 7, 8].map(dataVersion => ({ type: 'signupSlot', dataVersion }))
  assert.deepEqual(unseenServerPatches(patches, 7), [patches[2]])
  assert.deepEqual(unseenServerPatches(patches, null), patches)
})
