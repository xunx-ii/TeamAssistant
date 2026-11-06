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
let tempDir, backend, baseUrl, adminToken, migratedSnapshot, migratedPublicSnapshot
const legacyPublicAt = Date.now() + 3_600_000
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

function publicationTeam(id, publicSignup, publicAtMs = 0) {
  const team = emptyTeam(id)
  team.name = id
  Object.assign(team.config, { publicSignup, publicAtMs })
  return team
}

async function seedPublicationData(extra = {}) {
  const result = await request('/data', 'PUT', adminBody({
    teams: [publicationTeam('public-team', true), publicationTeam('private-team', false), publicationTeam('future-team', true, Date.now() + 60_000)],
    cancellations: [], archivedTeams: [], logs: [], userProfiles: {}, ...extra,
  }))
  assert.equal(result.ok, true)
  return (await request(`/access-gate?actorQq=${adminQq}&adminToken=${adminToken}`)).inviteToken
}

test('team publication filters snapshots for public, invited and authenticated admin viewers', async () => {
  const inviteToken = await seedPublicationData()
  const normal = await request('/bootstrap')
  assert.deepEqual(normal.teams.map(team => team.id), ['public-team'])
  assert.deepEqual((await request('/bootstrap?inviteToken=invalid')).teams.map(team => team.id), ['public-team'])
  assert.equal((await request(`/bootstrap?inviteToken=${inviteToken}`)).teams.length, 3)
  assert.equal((await request(`/bootstrap?qq=${adminQq}&adminToken=${adminToken}`)).teams.length, 3)
  assert.equal((await request(`/bootstrap?qq=${adminQq}`)).teams.length, 1, '管理员 QQ 本身不能绕过权限')
  assert.equal(normal.visibilityKey, 'public')
  assert.equal(JSON.stringify(normal).includes('private-team'), false)
  assert.equal(JSON.stringify(normal).includes('future-team'), false)
  const initial = await request('/sync')
  assert.deepEqual(initial.data.teams.map(team => team.id), ['public-team'])
})

test('hidden teams cannot leak through patches, locks or forged signup and subsidy requests', async () => {
  const inviteToken = await seedPublicationData()
  const baseline = await request('/version')
  const invited = createTeamClient({ baseUrl, inviteToken })
  await invited.signup('20001', 'private-team', 0, { martialArtIndex: '0', characterId: '提前用户' })
  const lock = await request('/slot-locks', 'POST', { teamId: 'private-team', slotIndex: 1, qq: '20002', inviteToken })
  assert.equal(lock.ok, true)
  const changes = await request(`/sync?dataVersion=${baseline.dataVersion}&lockVersion=${baseline.lockVersion}`)
  assert.deepEqual(changes.patches, [])
  assert.equal(changes.dataVersion > baseline.dataVersion, true)
  assert.deepEqual(changes.locks.slots, [])
  assert.deepEqual((await request('/locks')).slots, [])
  assert.equal((await request(`/locks?inviteToken=${inviteToken}`)).slots.length, 1)
  const blockedLock = await request('/slot-locks', 'POST', { teamId: 'private-team', slotIndex: 2, qq: '20003' })
  assert.equal(blockedLock.reason, 'notOpen')
  const forged = await request('/teams/private-team/slots/2/member', 'PUT', {
    teamId: 'public-team', actorQq: '20003', member: { qq: '20003', martialArtIndex: '0', characterId: '越权' },
  })
  assert.equal(forged.reason, 'notOpen')
  assert.equal((await request('/teams/private-team/subsidies/20003', 'PUT', { actorQq: '20003', selections: [] })).reason, 'notOpen')
  assert.equal((await request('/slot-locks/validate', 'POST', { teamId: 'private-team', slotIndex: 1, qq: '20002', lockToken: lock.lockToken })).reason, 'notOpen')
  const invitedChanges = await request(`/sync?dataVersion=${baseline.dataVersion}&lockVersion=${baseline.lockVersion}&inviteToken=${inviteToken}`)
  assert.equal(invitedChanges.patches[0].teamId, 'private-team')
  await invited.signup('20004', 'public-team', 0, { martialArtIndex: '0', characterId: '公开用户' })
  assert.equal((await request('/bootstrap')).teams[0].slots[0].member.qq, '20004')
})

test('history applies visibility before pagination and bootstrap limits', async () => {
  const logs = Array.from({ length: 550 }, (_, index) => ({
    id: `private-log-${index}`, teamId: 'private-team', teamName: 'private-team', timestamp: 10_000 + index,
    actorQq: '20001', action: '隐藏日志',
  }))
  logs.unshift(...Array.from({ length: 3 }, (_, index) => ({
    id: `public-log-${index}`, teamId: 'public-team', teamName: 'public-team', timestamp: 100 + index,
    actorQq: '20001', action: '公开日志',
  })))
  const cancellations = Array.from({ length: 220 }, (_, index) => ({
    qq: '20001', reason: '隐藏取消', cancelledBy: adminQq, teamId: 'private-team', teamName: 'private-team', slotIndex: 0, timestamp: 10_000 + index,
  }))
  cancellations.unshift({ ...cancellations[0], teamId: 'public-team', teamName: 'public-team', reason: '公开取消', timestamp: 100 })
  const inviteToken = await seedPublicationData({ logs, cancellations })
  const snapshot = await request('/bootstrap')
  assert.equal(snapshot.logs.length, 3)
  assert.equal(snapshot.logsTotal, 3)
  assert.equal(snapshot.logsTruncated, false)
  assert.equal(snapshot.cancellations.length, 1)
  assert.equal(snapshot.cancellationsTotal, 1)
  const first = await request('/logs?limit=2')
  assert.equal(first.items.length, 2)
  assert.equal(first.hasMore, true)
  assert.equal(first.items.every(item => item.teamId === 'public-team'), true)
  const second = await request(`/logs?limit=2&before=${first.nextCursor}`)
  assert.equal(second.items.length, 1)
  assert.equal(second.hasMore, false)
  assert.deepEqual((await request('/logs?teamId=private-team')).items, [])
  assert.equal((await request('/cancellations?qq=20001')).items.length, 1)
  assert.equal((await request(`/cancellations?qq=20001&inviteToken=${inviteToken}`)).items.length, 200)
})

test('scheduled publication updates existing cursors without another admin mutation', async () => {
  const publicAtMs = Date.now() + 1_500
  await seedPublicationData({ teams: [publicationTeam('scheduled-team', true, publicAtMs), publicationTeam('private-team', false)] })
  const initial = await request('/sync')
  assert.deepEqual(initial.data.teams, [])
  for (let attempt = 0; ; attempt++) {
    if ((await request('/version')).dataVersion > initial.dataVersion) break
    assert.ok(attempt < 100, '到公开时间后应推送新版本')
    await delay(50)
  }
  const changed = await request(`/sync?dataVersion=${initial.dataVersion}&lockVersion=${initial.lockVersion}`)
  assert.deepEqual(changed.data.teams.map(team => team.id), ['scheduled-team'])
})

test('publication changes, revoked links and lost admin sessions replace the visible snapshot', async () => {
  const inviteToken = await seedPublicationData()
  const invited = await request(`/sync?inviteToken=${inviteToken}`)
  const regenerated = await request('/access-gate/token', 'POST', adminBody())
  assert.notEqual(regenerated.inviteToken, inviteToken)
  const revoked = await request(`/sync?dataVersion=${invited.dataVersion}&lockVersion=${invited.lockVersion}&visibilityKey=${encodeURIComponent(invited.visibilityKey)}&inviteToken=${inviteToken}`)
  assert.deepEqual(revoked.data.teams.map(team => team.id), ['public-team'])
  const adminSnapshot = await request(`/sync?qq=${adminQq}&adminToken=${adminToken}`)
  const noSession = await request(`/sync?qq=${adminQq}&dataVersion=${adminSnapshot.dataVersion}&lockVersion=${adminSnapshot.lockVersion}&visibilityKey=admin`)
  assert.equal(noSession.dataChanged, true)
  assert.deepEqual(noSession.data.teams.map(team => team.id), ['public-team'])
  const ordinary = await request('/sync')
  assert.equal((await request('/teams/public-team', 'PATCH', adminBody({ publicSignup: false, publicAtMs: 0 }))).ok, true)
  const hidden = await request(`/sync?dataVersion=${ordinary.dataVersion}&lockVersion=${ordinary.lockVersion}`)
  assert.deepEqual(hidden.data.teams, [])
  assert.equal((await request('/teams/private-team', 'PATCH', adminBody({ publicSignup: true, publicAtMs: 0 }))).ok, true)
  assert.deepEqual((await request('/bootstrap')).teams.map(team => team.id), ['private-team'])
})

test('private archives retain publication restrictions through restore and subsidy routes', async () => {
  const inviteToken = await seedPublicationData()
  assert.equal((await request('/teams/private-team/archive', 'POST', adminBody({ archivedBy: adminQq, archivedAt: Date.now() }))).ok, true)
  assert.deepEqual((await request('/bootstrap')).archivedTeams, [])
  const invited = await request(`/bootstrap?inviteToken=${inviteToken}`)
  const archive = invited.archivedTeams[0]
  assert.equal(archive.team.config.publicSignup, false)
  assert.equal((await request(`/archives/${archive.id}/subsidies/20001`, 'PUT', { actorQq: '20001', selections: [] })).reason, 'notOpen')
  assert.equal((await request(`/archives/${archive.id}/restore`, 'POST', adminBody())).ok, true)
  assert.equal((await request('/bootstrap')).teams.some(team => team.id === 'private-team'), false)
})

test('scheduled archives publish even when another request refreshes the visibility cache', async () => {
  const publicAtMs = Date.now() + 1_500
  await seedPublicationData({ archivedTeams: [{ id: 'scheduled-archive', team: publicationTeam('archived-team', true, publicAtMs), archivedAt: Date.now(), archivedBy: adminQq }] })
  const before = await request('/sync')
  assert.deepEqual(before.data.archivedTeams, [])
  await delay(Math.max(0, publicAtMs - Date.now() + 10))
  assert.equal((await request('/bootstrap')).archivedTeams.length, 1)
  for (let attempt = 0; ; attempt++) {
    if ((await request('/version')).dataVersion > before.dataVersion) break
    assert.ok(attempt < 80, '归档公开也应通知现有客户端')
    await delay(50)
  }
  const after = await request(`/sync?dataVersion=${before.dataVersion}&lockVersion=${before.lockVersion}`)
  assert.equal(after.data.archivedTeams.length, 1)
})

test('invalid publication settings fail atomically', async () => {
  for (const publication of [{ publicSignup: 'false' }, { publicAtMs: -1 }, { publicAtMs: '1000' }, { publicAtMs: 1.5 }, { publicAtMs: 9_000_000_000_000_000 }]) {
    const team = emptyTeam('invalid-team')
    Object.assign(team.config, publication)
    const creation = await request('/teams/batch', 'POST', adminBody({ teams: [emptyTeam('also-invalid'), team] }))
    assert.equal(creation.status, 400)
    assert.equal((await request('/teams/team-1', 'PATCH', adminBody(publication))).status, 400)
    assert.deepEqual((await request('/bootstrap')).teams.map(item => item.id), ['team-1'])
  }
})

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
  legacy.prepare('INSERT INTO teams(id, name) VALUES(?, ?)').run('legacy-team', '旧团队')
  legacy.exec(`CREATE TABLE access_gate (
    id INTEGER PRIMARY KEY, public_at_ms INTEGER NOT NULL DEFAULT 0,
    invite_token TEXT NOT NULL DEFAULT '', updated_at_ms INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT ''
  )`)
  legacy.prepare('INSERT INTO access_gate(id, public_at_ms) VALUES(1, ?)').run(legacyPublicAt)
  legacy.exec('CREATE TABLE archives(id TEXT PRIMARY KEY, team_json TEXT NOT NULL, archived_at INTEGER NOT NULL, archived_by TEXT NOT NULL)')
  legacy.prepare('INSERT INTO archives VALUES(?, ?, ?, ?)').run('legacy-archive', JSON.stringify(emptyTeam('legacy-archived-team')), Date.now(), adminQq)
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
  migratedSnapshot = await request(`/bootstrap?qq=${adminQq}&adminToken=${adminToken}`)
  migratedPublicSnapshot = await request('/bootstrap')
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
    for (const name of ['sort_order', 'only_tn_signup', 'unique_qq_signup', 'public_signup', 'public_at_ms']) assert.ok(columns.includes(name))
    assert.ok(database.prepare('PRAGMA index_list(teams)').all().some(index => index.name === 'idx_teams_sort_order'))
    assert.equal(migratedSnapshot.teams[0].config.publicSignup, true)
    assert.equal(migratedSnapshot.teams[0].config.publicAtMs, legacyPublicAt)
    assert.deepEqual(migratedPublicSnapshot.teams, [])
    assert.deepEqual(migratedPublicSnapshot.archivedTeams, [])
    assert.equal(migratedSnapshot.archivedTeams[0].team.config.publicAtMs, legacyPublicAt)
    assert.equal(database.prepare('SELECT public_at_ms FROM access_gate').get().public_at_ms, 0)
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 'team_publication_v1'").get().count, 1)
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
