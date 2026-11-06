import type { Snapshot } from './dataStore'

export interface TeamPublication {
  publicSignup: boolean
  publicAtMs: number
}

export function isTeamPublic(config: Partial<TeamPublication>, now = Date.now()) {
  const publication = normalizeTeamPublication(config)
  return publication.publicSignup && publication.publicAtMs <= now
}

export function publicSnapshot(snapshot: Snapshot, now = Date.now()): Snapshot {
  const teams = snapshot.teams.filter(team => isTeamPublic(team.config, now))
  const archivedTeams = snapshot.archivedTeams.filter(archive => isTeamPublic(archive.team.config, now))
  const visibleIds = new Set([...teams.map(team => team.id), ...archivedTeams.map(archive => archive.team.id)])
  return {
    ...snapshot,
    teams,
    archivedTeams,
    logs: snapshot.logs.filter(log => !log.teamId || visibleIds.has(log.teamId)),
    cancellations: snapshot.cancellations.filter(item => visibleIds.has(item.teamId)),
  }
}

export function normalizeTeamPublication(value: { publicSignup?: unknown; publicAtMs?: unknown } | null | undefined): TeamPublication {
  const publicAtMs = value?.publicAtMs
  const validTime = publicAtMs === undefined || (typeof publicAtMs === 'number' && Number.isSafeInteger(publicAtMs) && publicAtMs >= 0 && publicAtMs <= 8_640_000_000_000_000)
  return {
    publicSignup: validTime && (value?.publicSignup === undefined || value.publicSignup === true),
    publicAtMs: typeof publicAtMs === 'number' && Number.isSafeInteger(publicAtMs) && publicAtMs >= 0 && publicAtMs <= 8_640_000_000_000_000
      ? publicAtMs
      : 0,
  }
}
