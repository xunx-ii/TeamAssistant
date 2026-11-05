// A response may arrive after a mutation or another request has already moved
// the cursor forward. A lower version is a server reset only when the cursor
// has not changed since this request began.
export function shouldApplySyncVersion(
  currentVersion: number | null,
  requestedVersion: number | null,
  responseVersion: number,
): boolean {
  return currentVersion === null || responseVersion >= currentVersion || currentVersion === requestedVersion
}

export function planMutationSync(currentVersion: number | null, responseVersion?: number) {
  const apply = responseVersion === undefined || currentVersion === null || responseVersion > currentVersion
  const contiguous = currentVersion !== null && responseVersion === currentVersion + 1
  return {
    apply,
    // Skipping a version here would prevent /sync from fetching other users'
    // changes. The mutation can be shown immediately while that gap is filled.
    nextVersion: contiguous && responseVersion !== undefined ? responseVersion : currentVersion,
    needsSync: apply && !contiguous,
  }
}

export function unseenServerPatches(patches: unknown[], currentVersion: number | null): unknown[] {
  return patches.filter(patch => (
    currentVersion === null ||
    !patch || typeof patch !== 'object' ||
    !('dataVersion' in patch) || typeof patch.dataVersion !== 'number' ||
    patch.dataVersion > currentVersion
  ))
}
