import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import { createTeamClient, TeamApiError } from '../../qqbot/src/team.js'

const root = resolve(import.meta.dirname, '../..')
const tempRoot = join(root, '.temp')
const adminQq = '10001'
const password = randomUUID()
let tempDir, backend, baseUrl, adminToken
let output = ''

async function request(path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
  return { status: response.status, ...await response.json() }
}

function adminBody(extra = {}) {
  return { actorQq: adminQq, adminToken, ...extra }
}

function emptyTeam(id = 'team-1') {
  return {
    id, name: '测试团队', note: '',
    config: { reservedSlots: [], locked: false },
    slots: Array.from({ length: 25 }, (_, index) => ({
      index, status: 'empty', member: null, fixedRole: null, fixedMartialArtIndex: null,
    })),
  }
}

before(async () => {
  const executable = ['', 'Release/', 'Debug/']
    .flatMap(dir => ['teamassistant_backend.exe', 'teamassistant_backend'].map(name => join(root, 'backend-cpp/build', dir, name)))
    .find(existsSync)
  assert.ok(executable, '请先构建 C++ 后端')
  mkdirSync(tempRoot, { recursive: true })
  tempDir = mkdtempSync(join(tempRoot, 'api-test-'))
  const configPath = join(tempDir, 'admin.json')
  writeFileSync(configPath, JSON.stringify({ adminQQs: [adminQq] }))
  copyFileSync(join(root, 'backend-cpp/schema.sql'), join(tempDir, 'schema.sql'))
  const legacy = new DatabaseSync(join(tempDir, 'test.sqlite3'))
  legacy.exec(`CREATE TABLE teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', week_start TEXT,
    locked INTEGER NOT NULL DEFAULT 0, reserved_slots_json TEXT NOT NULL DEFAULT '[]',
    subsidy_types_json TEXT, member_subsidies_json TEXT
  )`)
  legacy.close()
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  await new Promise(resolve => portProbe.close(resolve))
  baseUrl = `http://127.0.0.1:${port}/api/v2`
  backend = spawn(executable, [], {
    cwd: tempDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: String(port), TEAMASSISTANT_DB: 'test.sqlite3',
      TEAMASSISTANT_ADMIN_CONFIG: configPath, TEAMASSISTANT_ADMIN_PASSWORD: password,
      TEAMASSISTANT_ADMIN_PASSWORD_HASH: '', TEAMASSISTANT_ADMIN_PASSWORD_SALT: '',
    },
  })
  backend.stdout.on('data', chunk => { output += chunk })
  backend.stderr.on('data', chunk => { output += chunk })
  const exited = once(backend, 'exit').then(([code]) => { throw new Error(`后端提前退出 (${code}): ${output}`) })
  const ready = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await request('/version')
        if (response.ok) return
      } catch { /* 等待监听端口 */ }
      await delay(50)
    }
    throw new Error(`后端启动超时: ${output}`)
  }
  await Promise.race([ready(), exited])
  const login = await request('/admin/login', 'POST', { actorQq: adminQq, password })
  assert.equal(login.ok, true)
  adminToken = login.adminToken
})

beforeEach(async () => {
  assert.equal((await request('/access-gate', 'PUT', adminBody({ publicAtMs: 0 }))).ok, true)
  const result = await request('/data', 'PUT', adminBody({
    teams: [emptyTeam()], cancellations: [], archivedTeams: [], logs: [], userProfiles: {}, subsidyPresets: [],
  }))
  assert.equal(result.ok, true)
})

after(async () => {
  if (backend && backend.exitCode === null) {
    const exited = once(backend, 'exit')
    backend.kill()
    await exited
  }
  if (tempDir) {
    const target = relative(tempRoot, tempDir)
    assert.ok(target && !target.startsWith('..') && !isAbsolute(target))
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('legacy databases migrate their columns before the sorting index is created', () => {
  const database = new DatabaseSync(join(tempDir, 'test.sqlite3'), { readOnly: true })
  try {
    const columns = database.prepare('PRAGMA table_info(teams)').all().map(column => column.name)
    for (const name of ['sort_order', 'only_tn_signup', 'unique_qq_signup']) assert.ok(columns.includes(name))
    assert.ok(database.prepare('PRAGMA index_list(teams)').all().some(index => index.name === 'idx_teams_sort_order'))
  } finally {
    database.close()
  }
})

test('bot admin detection retains actorQq when an invite token is configured', async () => {
  const gate = await request('/access-gate', 'PUT', adminBody({ publicAtMs: Date.now() + 60_000 }))
  const client = createTeamClient({ baseUrl, inviteToken: gate.inviteToken })
  assert.equal(await client.checkAdmin(adminQq), true)
  assert.equal((await client.bootstrap('20001')).teams.length, 1)
})

test('bot translates slot contention and preserves team lock errors', async () => {
  const first = await request('/slot-locks', 'POST', { teamId: 'team-1', slotIndex: 0, qq: '20001' })
  assert.equal(first.ok, true)
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  await assert.rejects(client.signup('20002', 'team-1', 0), error => error instanceof TeamApiError && error.reason === 'lockedBy')
  assert.equal((await request('/team-locks', 'POST', adminBody({ teamId: 'team-1' }))).ok, true)
  await assert.rejects(client.signup('20002', 'team-1', 1), error => error instanceof TeamApiError && error.reason === 'teamLocked')
})

test('future sync cursors receive a full snapshot after a server version reset', async () => {
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  await client.signup('20001', 'team-1', 0, { martialArtIndex: '0', characterId: '玩家' })
  const version = await request('/version')
  const changes = await request(`/sync?dataVersion=${version.dataVersion + 100}&lockVersion=0`)
  assert.ok(changes.data)
  assert.equal(changes.data.teams[0].slots[0].member.qq, '20001')
})

test('concurrent signups survive incremental sync and release their locks', async () => {
  const baseline = await request('/version')
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  await Promise.all([
    ...Array.from({ length: 25 }, (_, index) => client.signup(String(20000 + index), 'team-1', index, {
      martialArtIndex: '0', characterId: `玩家${index}`,
    })),
    ...Array.from({ length: 5 }, async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const live = await request(`/sync?dataVersion=${baseline.dataVersion}&lockVersion=${baseline.lockVersion}`)
        if (live.patches) {
          assert.equal(live.patches.length, live.dataVersion - baseline.dataVersion)
          assert.equal(live.patches.at(-1)?.dataVersion ?? baseline.dataVersion, live.dataVersion)
        }
      }
    }),
  ])
  const changes = await request(`/sync?dataVersion=${baseline.dataVersion}&lockVersion=${baseline.lockVersion}`)
  assert.equal(changes.patches.length, 25)
  assert.deepEqual(changes.patches.map(patch => patch.dataVersion), Array.from({ length: 25 }, (_, index) => baseline.dataVersion + index + 1))
  assert.equal(changes.patches.at(-1).dataVersion, changes.dataVersion)
  assert.equal(changes.locks.slots.length, 0)
  const snapshot = await client.bootstrap('20000')
  assert.equal(snapshot.teams[0].slots.filter(slot => slot.member).length, 25)
})

test('signup rejects a stale member expectation without replacing the player', async () => {
  const client = createTeamClient({ baseUrl, inviteToken: '' })
  await client.signup('20001', 'team-1', 0, { martialArtIndex: '0', characterId: '玩家甲' })
  await assert.rejects(client.signup('20002', 'team-1', 0, { martialArtIndex: '0' }), error => error.reason === 'slotChanged')
  assert.equal((await client.bootstrap('20001')).teams[0].slots[0].member.qq, '20001')
  assert.equal((await request('/locks')).slots.length, 0)
})
