import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const tempRoot = join(root, '.temp')
mkdirSync(tempRoot, { recursive: true })

function fixture(t) {
  const dir = mkdtempSync(join(tempRoot, 'docker-config-'))
  t.after(() => {
    const target = relative(tempRoot, dir)
    assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
    rmSync(dir, { recursive: true, force: true })
  })
  const configPath = join(dir, 'admin.json')
  const run = (env = {}) => spawnSync(process.execPath, [join(root, 'docker/prepare-config.mjs')], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    env: {
      ...process.env,
      TEAMASSISTANT_ADMIN_CONFIG: configPath,
      TEAMASSISTANT_ADMIN_QQS: '',
      TEAMASSISTANT_ADMIN_PASSWORD: '',
      TEAMASSISTANT_ADMIN_PASSWORD_SALT: '',
      TEAMASSISTANT_ADMIN_PASSWORD_HASH: '',
      QQBOT_ENABLED: 'false',
      QQ_APP_ID: '',
      QQ_APP_SECRET: '',
      ...env,
    },
  })
  return { configPath, run }
}

test('environment initializes administrator list without persisting runtime secrets', t => {
  const { configPath, run } = fixture(t)
  const result = run({
    TEAMASSISTANT_ADMIN_QQS: '10001, 20002,10001',
    TEAMASSISTANT_ADMIN_PASSWORD: 'runtime-password',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { adminQQs: ['10001', '20002'] })
  if (process.platform !== 'win32') assert.equal(statSync(configPath).mode & 0o777, 0o600)
})

test('mounted administrator configuration is reused without writing to it', t => {
  const { configPath, run } = fixture(t)
  const original = JSON.stringify({ admins: ['10001'], adminPasswordHash: 'a'.repeat(64), adminPasswordSalt: 'salt' })
  writeFileSync(configPath, original)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(configPath, 'utf8'), original)
})

test('environment updates the administrator list while preserving existing password hashes', t => {
  const { configPath, run } = fixture(t)
  const passwordConfig = { adminPasswordHash: 'b'.repeat(64), adminPasswordSalt: 'saved-salt' }
  writeFileSync(configPath, JSON.stringify({ adminQQs: ['10001'], ...passwordConfig }))
  const result = run({ TEAMASSISTANT_ADMIN_QQS: '20002' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { adminQQs: ['20002'], ...passwordConfig })
})

test('environment accepts a password hash without persisting it', t => {
  const { configPath, run } = fixture(t)
  const result = run({ TEAMASSISTANT_ADMIN_QQS: '10001', TEAMASSISTANT_ADMIN_PASSWORD_HASH: 'c'.repeat(64) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { adminQQs: ['10001'] })
})

test('enabled bot accepts runtime QQ credentials without persisting them', t => {
  const { configPath, run } = fixture(t)
  const result = run({
    TEAMASSISTANT_ADMIN_QQS: '10001', TEAMASSISTANT_ADMIN_PASSWORD: 'test-password',
    QQBOT_ENABLED: 'true', QQ_APP_ID: 'test-app-id', QQ_APP_SECRET: 'test-app-secret',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { adminQQs: ['10001'] })
})

for (const [name, env, message] of [
  ['missing administrators', { TEAMASSISTANT_ADMIN_QQS: '' }, /TEAMASSISTANT_ADMIN_QQS/],
  ['invalid QQ number', { TEAMASSISTANT_ADMIN_QQS: 'not-a-qq' }, /TEAMASSISTANT_ADMIN_QQS/],
  ['empty QQ list item', { TEAMASSISTANT_ADMIN_QQS: '10001,' }, /TEAMASSISTANT_ADMIN_QQS/],
  ['missing password', { TEAMASSISTANT_ADMIN_PASSWORD: '' }, /TEAMASSISTANT_ADMIN_PASSWORD/],
  ['invalid password hash', { TEAMASSISTANT_ADMIN_PASSWORD_HASH: 'invalid' }, /64/],
  ['missing bot credentials', { QQBOT_ENABLED: 'true' }, /QQ_APP_ID/],
  ['partial bot credentials', { QQBOT_ENABLED: 'true', QQ_APP_ID: 'configured-id' }, /QQ_APP_ID/],
]) {
  test(`configuration rejects ${name} before writing state`, t => {
    const { configPath, run } = fixture(t)
    const result = run({ TEAMASSISTANT_ADMIN_QQS: '10001', TEAMASSISTANT_ADMIN_PASSWORD: 'test-password', ...env })
    assert.equal(result.status, 1)
    assert.match(result.stderr, message)
    assert.equal(existsSync(configPath), false)
  })
}

test('malformed administrator files fail without replacing the original', t => {
  const { configPath, run } = fixture(t)
  writeFileSync(configPath, '{invalid JSON')
  const result = run({ TEAMASSISTANT_ADMIN_QQS: '10001', TEAMASSISTANT_ADMIN_PASSWORD: 'test-password' })
  assert.equal(result.status, 1)
  assert.equal(readFileSync(configPath, 'utf8'), '{invalid JSON')
})
