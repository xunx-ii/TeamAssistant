import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const smoke = readFileSync(join(root, 'docker/smoke-test.sh'), 'utf8')

test('container smoke test initializes group membership before authentication', () => {
  const membershipIndex = smoke.indexOf('/api/v2/internal/group-members/sync')
  const memberLoginIndex = smoke.indexOf('/api/v2/auth/qq/login')
  const adminLoginIndex = smoke.indexOf('/api/v2/admin/login')

  assert.ok(membershipIndex >= 0)
  assert.ok(memberLoginIndex > membershipIndex)
  assert.ok(adminLoginIndex > memberLoginIndex)
  assert.match(smoke, /X-TeamAssistant-Bot-Token/)
  assert.match(smoke, /X-TeamAssistant-Member-Token/)
})

test('container smoke test protects persisted-data bootstrap requests', () => {
  const bootstrapIndex = smoke.lastIndexOf('/api/v2/bootstrap?qq=')
  assert.ok(bootstrapIndex >= 0)
  const bootstrapBlock = smoke.slice(Math.max(0, bootstrapIndex - 220), bootstrapIndex + 120)
  assert.match(bootstrapBlock, /X-TeamAssistant-Member-Token/)
  assert.match(smoke, /\[\[ "\$status" == 401 \]\]/)
})
