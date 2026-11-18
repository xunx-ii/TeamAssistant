const STORAGE_PREFIX = 'team_note_draft_v1:'

function storageKey(teamId: string, actorQq: string) {
  return `${STORAGE_PREFIX}${teamId}:${actorQq}`
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadTeamNoteDraft(teamId: string, actorQq: string): string | null {
  if (!teamId || !actorQq) return null
  try {
    return getStorage()?.getItem(storageKey(teamId, actorQq)) ?? null
  } catch {
    return null
  }
}

export function saveTeamNoteDraft(teamId: string, actorQq: string, note: string) {
  if (!teamId || !actorQq) return
  try {
    getStorage()?.setItem(storageKey(teamId, actorQq), note)
  } catch {
    // Draft protection is best-effort when browser storage is unavailable.
  }
}

export function clearTeamNoteDraft(teamId: string, actorQq: string, expectedNote?: string) {
  if (!teamId || !actorQq) return
  const storage = getStorage()
  if (!storage) return
  try {
    const key = storageKey(teamId, actorQq)
    if (expectedNote !== undefined && storage.getItem(key) !== expectedNote) return
    storage.removeItem(key)
  } catch {
    // Best-effort cleanup only.
  }
}
