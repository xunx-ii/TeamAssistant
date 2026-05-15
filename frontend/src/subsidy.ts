import type { ArchivedTeam, MemberSubsidySelection, SubsidyTarget, Team } from './types'
import { getCurrentWeekStartKey, getWeekStartKey } from './week'

export function resolveSubsidySelectionWeekStart(selection: MemberSubsidySelection, fallbackWeekStart: string) {
  return selection.weekStart ?? fallbackWeekStart
}

function hasSubsidies(team: Pick<Team, 'subsidyTypes'>) {
  return (team.subsidyTypes?.length ?? 0) > 0
}

function getTeamSubsidyWeekStart(team: Pick<Team, 'weekStart'>, fallbackWeekStart: string) {
  return team.weekStart ?? fallbackWeekStart
}

function normalizeSelectionsForWeek(selections: MemberSubsidySelection[] | undefined, fallbackWeekStart: string) {
  return (selections ?? [])
    .map(selection => ({
      ...selection,
      weekStart: resolveSubsidySelectionWeekStart(selection, fallbackWeekStart),
    }))
    .filter(selection => selection.weekStart === fallbackWeekStart)
}

function getMemberSubsidySelections(
  memberSubsidies: Record<string, MemberSubsidySelection[]> | undefined,
  qq: string,
) {
  const value = memberSubsidies ? Object.getOwnPropertyDescriptor(memberSubsidies, qq)?.value : undefined
  return Array.isArray(value) ? value : undefined
}

export function createSubsidyTargets(
  teams: Team[],
  archivedTeams: ArchivedTeam[],
  qq: string | null,
  currentWeekStart = getCurrentWeekStartKey(),
) {
  const targets: SubsidyTarget[] = []

  for (const team of teams) {
    if (!hasSubsidies(team)) continue
    const teamWeekStart = getTeamSubsidyWeekStart(team, currentWeekStart)
    targets.push({
      id: `team:${team.id}`,
      name: team.name,
      weekStart: teamWeekStart,
      currentSelections: qq ? normalizeSelectionsForWeek(getMemberSubsidySelections(team.memberSubsidies, qq), teamWeekStart) : [],
      teamId: team.id,
      subsidyTypes: team.subsidyTypes ?? [],
      memberSubsidies: team.memberSubsidies ?? {},
    })
  }

  for (const archive of archivedTeams) {
    if (!hasSubsidies(archive.team)) continue
    const archiveWeekStart = getTeamSubsidyWeekStart(archive.team, getWeekStartKey(archive.archivedAt))
    targets.push({
      id: `archive:${archive.id}`,
      name: `${archive.team.name}（归档）`,
      weekStart: archiveWeekStart,
      currentSelections: qq ? normalizeSelectionsForWeek(getMemberSubsidySelections(archive.team.memberSubsidies, qq), archiveWeekStart) : [],
      archiveId: archive.id,
      archivedAt: archive.archivedAt,
      subsidyTypes: archive.team.subsidyTypes ?? [],
      memberSubsidies: archive.team.memberSubsidies ?? {},
    })
  }

  return targets
}

export function getSubsidyRegistrationTargets(targets: SubsidyTarget[], currentWeekStart = getCurrentWeekStartKey()) {
  return targets.filter(target => target.weekStart === currentWeekStart)
}

export function getSubsidyWeekOptions(targets: SubsidyTarget[], currentWeekStart = getCurrentWeekStartKey()) {
  const weeks = new Set<string>([currentWeekStart])
  for (const target of targets) {
    weeks.add(target.weekStart)
    for (const selections of Object.values(target.memberSubsidies)) {
      for (const selection of selections) {
        weeks.add(resolveSubsidySelectionWeekStart(selection, target.weekStart))
      }
    }
  }
  return [...weeks].sort((a, b) => b.localeCompare(a))
}
