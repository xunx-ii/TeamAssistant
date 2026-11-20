import type { OperationLog } from './types'

export type OperationLogScope = 'team' | 'all'

export const OPERATION_LOG_PAGE_SIZE = 50
export const OPERATION_LOG_LOCAL_FALLBACK_LIMIT = 50

const PUBLIC_TEAM_LOG_PREFIXES = ['报名 #', '修改 #', '退出 #', '取消 #', '指定 #']

export function isPublicTeamLogAction(action: string) {
  return PUBLIC_TEAM_LOG_PREFIXES.some(prefix => action.startsWith(prefix))
}

export function formatOperationLogActor(actorQq: string, isAdmin: boolean) {
  if (!actorQq) return '-'
  if (isAdmin || actorQq.includes('*')) return actorQq
  if (actorQq.length <= 4) return '***'
  return `${actorQq.slice(0, 2)}***${actorQq.slice(-2)}`
}

export function getOperationLogsForScope(
  logs: OperationLog[],
  scope: OperationLogScope,
  teamId?: string,
  includeSensitive = false,
) {
  if (scope === 'all') {
    return includeSensitive
      ? logs
      : logs.filter(log => Boolean(log.teamId) && isPublicTeamLogAction(log.action))
  }
  if (!teamId) return []
  return logs.filter(log => (
    log.teamId === teamId &&
    (includeSensitive || isPublicTeamLogAction(log.action))
  ))
}
