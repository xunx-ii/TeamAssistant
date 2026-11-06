import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultTeam, createTeamsFromGuide, createTeamCopies } from '../src/teamCreation.ts'
import { normalizeHydratableData } from '../src/dataHydration.ts'
import { applyMutation } from '../src/dataStore.ts'
import { createTeamPublicationDraft, isTeamPublic, publicSnapshot, resolveTeamPublicationDraft } from '../src/teamPublication.ts'
import { parseShanghaiDateTimeLocalInput } from '../src/time.ts'

const values = {
  name: '提前团队', count: 2, weekStart: '2026-11-02', subsidyPresetIds: [],
  onlyTnSignup: false, uniqueQqSignup: false, quickReserve: true,
  reserveT: 2, reserveHealer: 2, reserveBoss: 0,
}

test('non-public signup is opt-in and an optional publication time controls automatic opening', () => {
  const publicAtInput = '2026-11-06T20:00'
  const publicAtMs = parseShanghaiDateTimeLocalInput(publicAtInput)
  const immediate = resolveTeamPublicationDraft({ nonPublicSignup: false, publicAtInput })
  assert.deepEqual(immediate, { publicSignup: true, publicAtMs: 0 })
  assert.equal(isTeamPublic(immediate, publicAtMs - 1), true)

  const inviteOnly = resolveTeamPublicationDraft({ nonPublicSignup: true, publicAtInput: '' })
  assert.deepEqual(inviteOnly, { publicSignup: false, publicAtMs: 0 })
  assert.equal(isTeamPublic(inviteOnly, publicAtMs + 1), false)

  const scheduled = resolveTeamPublicationDraft({ nonPublicSignup: true, publicAtInput })
  assert.deepEqual(scheduled, { publicSignup: true, publicAtMs })
  for (const team of createTeamsFromGuide({ ...values, ...scheduled }, [])) {
    assert.equal(isTeamPublic(team.config, publicAtMs - 1), false)
    assert.equal(isTeamPublic(team.config, publicAtMs), true)
  }
})

test('publication editing retains existing private and scheduled policies', () => {
  const publicAtInput = '2026-11-06T20:00'
  const publicAtMs = parseShanghaiDateTimeLocalInput(publicAtInput)
  for (const publication of [
    { publicSignup: true, publicAtMs: 0 },
    { publicSignup: false, publicAtMs: 0 },
    { publicSignup: true, publicAtMs },
  ]) {
    const draft = createTeamPublicationDraft(publication, publicAtMs - 1)
    assert.equal(draft.nonPublicSignup, !isTeamPublic(publication, publicAtMs - 1))
    assert.deepEqual(resolveTeamPublicationDraft(draft), publication)
  }
  assert.deepEqual(createTeamPublicationDraft({ publicSignup: true, publicAtMs }, publicAtMs), {
    nonPublicSignup: false, publicAtInput: '',
  })
})

test('invalid scheduled times cannot accidentally publish a non-public team', () => {
  for (const publicAtInput of ['invalid', '2026-02-31T20:00', '1969-12-31T20:00']) {
    assert.equal(resolveTeamPublicationDraft({ nonPublicSignup: true, publicAtInput }), null)
  }
  assert.deepEqual(resolveTeamPublicationDraft({ nonPublicSignup: false, publicAtInput: 'invalid' }), {
    publicSignup: true, publicAtMs: 0,
  })
})

test('batch creation and copying retain per-team publication independently of signup rules', () => {
  const publicAtMs = parseShanghaiDateTimeLocalInput('2026-11-06T20:00')
  const teams = createTeamsFromGuide({ ...values, publicSignup: true, publicAtMs }, [])
  for (const team of [...teams, ...createTeamCopies(teams[0], '副本', 2)]) {
    assert.equal(team.config.publicSignup, true)
    assert.equal(team.config.publicAtMs, publicAtMs)
    assert.equal(isTeamPublic(team.config, publicAtMs - 1), false)
    assert.equal(isTeamPublic(team.config, publicAtMs), true)
  }
  const privateTeams = createTeamsFromGuide({ ...values, publicSignup: false, publicAtMs: 0 }, [])
  assert.equal(isTeamPublic(privateTeams[0].config, publicAtMs), false)
  assert.equal(createTeamCopies(privateTeams[0], '副本', 1)[0].config.publicSignup, false)
})

test('legacy snapshots stay public while hydration and publication edits preserve restrictions', () => {
  const legacy = createDefaultTeam('旧团队')
  delete legacy.config.publicSignup
  delete legacy.config.publicAtMs
  const hydrated = normalizeHydratableData({ teams: [legacy] })
  assert.equal(hydrated.teams[0].config.publicSignup, true)
  assert.equal(hydrated.teams[0].config.publicAtMs, 0)
  const snapshot = applyMutation(hydrated, { type: 'updateTeamPublication', teamId: legacy.id, publicSignup: false, publicAtMs: 0 })
  assert.equal(snapshot.teams[0].config.publicSignup, false)
  assert.equal(hydrated.teams[0].config.publicSignup, true)
  assert.equal(normalizeHydratableData(snapshot).teams[0].config.publicSignup, false)
})

test('offline fallback removes private teams, future teams and their related history', () => {
  const publicTeam = createDefaultTeam('公开团队')
  const privateTeam = createDefaultTeam('提前团队')
  privateTeam.config.publicSignup = false
  const futureTeam = createDefaultTeam('未来团队')
  futureTeam.config.publicAtMs = 2000
  const snapshot = { teams: [publicTeam, privateTeam, futureTeam],
    archivedTeams: [{ id: 'archive', team: privateTeam, archivedAt: 1, archivedBy: '10001' }],
    logs: [{ teamId: '' }, ...[publicTeam, privateTeam, futureTeam].map(team => ({ teamId: team.id }))],
    cancellations: [publicTeam, privateTeam, futureTeam].map(team => ({ teamId: team.id })), userProfiles: {},
  }
  const filtered = publicSnapshot(snapshot, 1000)
  assert.deepEqual(filtered.teams.map(team => team.id), [publicTeam.id])
  assert.deepEqual(filtered.archivedTeams, [])
  assert.deepEqual(filtered.logs.map(log => log.teamId), ['', publicTeam.id])
  assert.deepEqual(filtered.cancellations.map(item => item.teamId), [publicTeam.id])
  assert.equal(snapshot.teams.length, 3)
})
