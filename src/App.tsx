import { useState, useEffect, useCallback } from 'react'
import { loadAdminQQs } from './config'
import { initTheme } from './storage/theme'
import {
  getStoredQQ, setStoredQQ, removeStoredQQ,
  loadTeams, saveTeams, setTeamsLocal,
  loadCancellations, saveCancellations, setCancellationsLocal,
  initServerMode, loadFromServer,
} from './storage'
import type { Member, Cancellation, Team } from './types'
import { createEmptySlots, generateId } from './types'
import { martialArts } from './data/martialArts'
import { fetchData, fetchLocks, fetchTeamLocks, lockTeam, mutateData, unlockTeam, type MutationResult, type SlotLock, type TeamLockInfo } from './api'
import { applyMutation, type Mutation, type Snapshot } from './dataStore'
import { TeamTabs } from './components/TeamTabs'
import { AdminConfig } from './components/AdminConfig'
import { SlotGrid } from './components/SlotGrid'
import { SlotRolePicker } from './components/SlotRolePicker'
import { SignupModal } from './components/SignupModal'
import { CancelModal } from './components/CancelModal'
import { CancellationNotice } from './components/CancellationNotice'
import { CreateTeamDialog } from './components/CreateTeamDialog'
import { Button } from './components/ui/button'
import { ThemeToggle } from './components/ThemeToggle'

function createDefaultTeam(name = '默认团队'): Team {
  return {
    id: generateId(),
    name,
    note: '',
    config: { reservedSlots: [], locked: false },
    slots: createEmptySlots(),
  }
}

function findPendingNotice(qq: string | null, cancellations: Cancellation[]) {
  if (!qq) return null
  return cancellations.find(item => item.qq === qq) ?? null
}

function App() {
  const [qq, setQq] = useState<string | null>(getStoredQQ)
  const [teams, setTeams] = useState<Team[]>(() => {
    const stored = loadTeams()
    if (stored.length > 0) return stored
    const def = createDefaultTeam()
    saveTeams([def])
    return [def]
  })
  const [activeTeamId, setActiveTeamId] = useState<string>(teams[0]?.id ?? '')
  const [cancellations, setCancellations] = useState<Cancellation[]>(loadCancellations)
  const [adminQQs, setAdminQQs] = useState<string[]>([])

  const [signupSlot, setSignupSlot] = useState<number | null>(null)
  const [editSlot, setEditSlot] = useState<number | null>(null)
  const [cancelSlot, setCancelSlot] = useState<number | null>(null)
  const [setRoleSlot, setSetRoleSlot] = useState<number | null>(null)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [serverMode, setServerMode] = useState(false)
  const [locks, setLocks] = useState<SlotLock[]>([])
  const [teamLocks, setTeamLocks] = useState<TeamLockInfo[]>([])
  const [mutationError, setMutationError] = useState('')

  const isAdmin = qq ? adminQQs.includes(qq) : false
  const activeTeamExists = teams.some(t => t.id === activeTeamId)
  const resolvedActiveTeamId = activeTeamExists ? activeTeamId : (teams[0]?.id ?? '')
  const activeTeam = teams.find(t => t.id === resolvedActiveTeamId) ?? teams[0]
  const notice = findPendingNotice(qq, cancellations)

  const syncSnapshot = useCallback((snapshot: Snapshot) => {
    setTeams(snapshot.teams)
    setCancellations(snapshot.cancellations)
    setTeamsLocal(snapshot.teams)
    setCancellationsLocal(snapshot.cancellations)
  }, [])

  useEffect(() => {
    initServerMode().then(async (sm) => {
      setServerMode(sm)
      if (sm) {
        const ok = await loadFromServer()
        if (ok) {
          const loadedTeams = loadTeams()
          const loadedCancellations = loadCancellations()
          syncSnapshot({ teams: loadedTeams, cancellations: loadedCancellations })
          if (loadedTeams.length > 0) {
            setActiveTeamId(loadedTeams[0].id)
          }
        } else {
          // Server is empty/new - push local data to server
          await saveTeams(loadTeams())
          await saveCancellations(loadCancellations())
        }
      }
    })
  }, [syncSnapshot])

  useEffect(() => { loadAdminQQs().then(setAdminQQs) }, [])
  useEffect(() => { initTheme() }, [])

  // Poll locks from server (fast polling for editing indicators + team locks)
  useEffect(() => {
    if (!serverMode) return
    const poll = async () => {
      const [slots, teams] = await Promise.all([fetchLocks(), fetchTeamLocks()])
      setLocks(slots)
      setTeamLocks(teams)
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => clearInterval(interval)
  }, [serverMode])

  // Poll server for real-time data updates (teams, cancellations, locks fallback)
  useEffect(() => {
    if (!serverMode) return
    let lastSnapshotJson = ''
    const poll = async () => {
      const data = await fetchData()
      if (!data) return
      // Also update locks from data poll as fallback
      if (data.locks) setLocks(data.locks)
      const snapshot = { teams: data.teams || [], cancellations: data.cancellations || [] }
      const snapshotJson = JSON.stringify(snapshot)
      if (snapshotJson !== lastSnapshotJson) {
        lastSnapshotJson = snapshotJson
        syncSnapshot(snapshot)
      }
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [serverMode, syncSnapshot])

  const clearModals = () => {
    setSignupSlot(null); setEditSlot(null); setCancelSlot(null); setSetRoleSlot(null)
  }

  const applyLocalMutation = useCallback((mutation: Mutation) => {
    const next = applyMutation({ teams, cancellations }, mutation)
    syncSnapshot(next)
    return next
  }, [teams, cancellations, syncSnapshot])

  const runMutation = useCallback(async (mutation: Mutation): Promise<MutationResult> => {
    setMutationError('')
    if (!serverMode) {
      applyLocalMutation(mutation)
      return { ok: true }
    }

    const result = await mutateData(mutation)
    if (result.ok && result.data) {
      syncSnapshot({ teams: result.data.teams, cancellations: result.data.cancellations })
      return result
    }

    if (!result.ok) {
      if (result.reason === 'teamLocked') {
        setMutationError('表格已被管理员锁定')
      } else if (result.reason === 'expired') {
        setMutationError('该位置已被其他人抢占，请刷新后重试')
      } else if (result.reason === 'slotChanged') {
        setMutationError('该位置内容已变更，请刷新后重试')
      } else if (result.error) {
        setMutationError(result.error)
      } else {
        setMutationError('保存失败，请稍后再试')
      }
    }

    return result
  }, [applyLocalMutation, serverMode, syncSnapshot])

  const switchTeam = (id: string) => { setActiveTeamId(id); clearModals(); setMutationError('') }

  const handleLogin = (userQq: string) => { setStoredQQ(userQq); setQq(userQq) }
  const handleLogout = () => { removeStoredQQ(); setQq(null); setMutationError(''); clearModals() }

  const dismissNotice = async () => {
    if (notice) {
      await runMutation({ type: 'dismissCancellation', qq: notice.qq, timestamp: notice.timestamp })
    }
  }

  const handleShowCreateTeam = useCallback(() => setShowCreateTeam(true), [])
  const handleSignupSlot = useCallback((idx: number) => setSignupSlot(idx), [])
  const handleEditSlot = useCallback((idx: number) => setEditSlot(idx), [])
  const handleSetRoleSlotClick = useCallback((idx: number) => setSetRoleSlot(idx), [])
  const handleSignupFromRole = useCallback(() => {
    if (setRoleSlot !== null) {
      setSignupSlot(setRoleSlot)
      setSetRoleSlot(null)
    }
  }, [setRoleSlot])

  const handleAdminRename = useCallback((name: string) => {
    if (activeTeam) {
      void runMutation({ type: 'renameTeam', teamId: activeTeam.id, name })
    }
  }, [activeTeam, runMutation])

  const handleCreateTeam = async (name: string) => {
    const team = createDefaultTeam(name.trim())
    const result = await runMutation({ type: 'createTeam', team })
    if (result.ok) {
      setActiveTeamId(team.id)
      clearModals()
      setShowCreateTeam(false)
    }
  }

  const handleDeleteTeam = async (id: string) => {
    if (!confirm('确定删除此团队？')) return
    const remaining = teams.filter(team => team.id !== id)
    const fallbackTeam = remaining.length > 0 ? undefined : createDefaultTeam()
    const result = await runMutation({ type: 'deleteTeam', teamId: id, fallbackTeam })
    if (result.ok && resolvedActiveTeamId === id) {
      const nextActive = remaining[0]?.id ?? fallbackTeam?.id ?? ''
      setActiveTeamId(nextActive)
    }
  }

  const handleRenameTeam = (id: string, name: string) => { void runMutation({ type: 'renameTeam', teamId: id, name }) }

  const handleUpdateNote = (note: string) => {
    if (!activeTeam) return
    void runMutation({ type: 'updateTeamNote', teamId: activeTeam.id, note })
  }

  const handleSetSlotRole = async (role: 'T' | '治疗' | 'DPS' | 'boss' | null, martialArtIndex: number | null, assignQQ?: string) => {
    const slotIndex = setRoleSlot
    if (slotIndex === null || !activeTeam) return
    const result = await runMutation({
      type: 'setSlotRole',
      teamId: activeTeam.id,
      slotIndex,
      role,
      martialArtIndex,
      assignQQ,
    })
    if (result.ok) {
      setSetRoleSlot(null)
    }
  }

  const handleQuickReserve = (type: 'T' | '治疗' | 'boss', count: number) => {
    if (!activeTeam) return
    void runMutation({ type: 'quickReserve', teamId: activeTeam.id, reserveType: type, count })
  }

  const handleSignupConfirm = async (data: Omit<Member, 'qq'>, lockTimestamp?: number) => {
    const slotIndex = signupSlot ?? editSlot
    if (slotIndex === null || !qq || !activeTeam) return
    const originalQq = editSlot !== null ? activeTeam.slots[editSlot]?.member?.qq : null
    if (originalQq && originalQq !== qq && !isAdmin) return
    const member: Member = { qq: originalQq || qq, ...data }
    const result = await runMutation({
      type: 'signupSlot',
      teamId: activeTeam.id,
      slotIndex,
      member,
      actorQq: qq,
      lockTimestamp,
      expectedMemberQq: originalQq ?? null,
    })
    if (result.ok) {
      clearModals()
    }
  }

  const handleCancelConfirm = async (reason: string, lockTimestamp?: number) => {
    if (cancelSlot === null || !qq || !activeTeam) return
    const slot = activeTeam.slots[cancelSlot]
    if (slot?.member) {
      const result = await runMutation({
        type: 'cancelSlot',
        teamId: activeTeam.id,
        slotIndex: cancelSlot,
        reason,
        cancelledBy: qq,
        actorQq: qq,
        lockTimestamp,
        expectedMemberQq: slot.member.qq,
      })
      if (result.ok) {
        setCancelSlot(null)
      }
    }
  }

  const handleLeave = async (slotIndex: number, lockTimestamp?: number) => {
    if (!activeTeam || !qq) return
    const expectedMemberQq = activeTeam.slots[slotIndex]?.member?.qq ?? null
    const result = await runMutation({
      type: 'leaveSlot',
      teamId: activeTeam.id,
      slotIndex,
      actorQq: qq,
      lockTimestamp,
      expectedMemberQq,
    })
    if (result.ok) {
      clearModals()
    }
  }

  // Get T/Healer martial art indices already taken in the team (excludes boss slots, excludes current editing slot)
  const getTakenMartialArts = (excludeSlot?: number): number[] => {
    if (!activeTeam) return []
    const indices: number[] = []
    for (const s of activeTeam.slots) {
      if (s.status === 'occupied' && s.member) {
        if (excludeSlot !== undefined && s.index === excludeSlot) continue
        if (activeTeam.config.reservedSlots.includes(s.index)) continue
        const idx = parseInt(s.member.martialArtIndex)
        if (!isNaN(idx) && idx < martialArts.length) {
          const role = martialArts[idx].role
          if (role === 'T' || role === '治疗') indices.push(idx)
        }
      }
    }
    return indices
  }

  if (!qq) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <>
      {notice && (
        <CancellationNotice open={!!notice} notice={notice} onDismiss={() => { void dismissNotice() }} />
      )}
      <div className="min-h-screen bg-background">
        <div className="max-w-[960px] mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-foreground">兔扇报名助手</h1>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <span className="inline-flex items-center rounded-full bg-amber-950/50 border border-amber-800 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                  管理员
                </span>
              )}
              {serverMode && (
                <span className="text-[11px] text-blue-400 bg-blue-950/30 rounded px-1.5 py-0.5">同步</span>
              )}
              <span className="text-sm text-muted-foreground">{qq}</span>
              <Button variant="outline" size="sm" onClick={handleLogout}>退出</Button>
            </div>
          </div>

          <TeamTabs
            teams={teams.map(t => ({ id: t.id, name: t.name }))}
            activeId={resolvedActiveTeamId}
            isAdmin={isAdmin}
            onSwitch={switchTeam}
            onCreate={handleShowCreateTeam}
            onDelete={handleDeleteTeam}
            onRename={handleRenameTeam}
            onReorder={(ids) => {
              void runMutation({ type: 'reorderTeams', ids })
            }}
          />

          {activeTeam && (
            <div className="mt-4">
              {isAdmin && (
                <AdminConfig
                  teamName={activeTeam.name}
                  note={activeTeam.note}
                  serverMode={serverMode}
                  locked={activeTeam.config.locked}
                  onRename={handleAdminRename}
                  onUpdateNote={handleUpdateNote}
                  onQuickReserve={handleQuickReserve}
                  onToggleLock={async () => {
                    if (!activeTeam) return
                    const newLocked = !activeTeam.config.locked
                    const result = await runMutation({ type: 'toggleTeamConfigLock', teamId: activeTeam.id, locked: newLocked })
                    if (result.ok && serverMode) {
                      void (newLocked ? lockTeam : unlockTeam)(activeTeam.id)
                    }
                  }}
                />
              )}
              <SlotGrid
                slots={activeTeam.slots}
                config={activeTeam.config}
                currentQQ={qq}
                isAdmin={isAdmin}
                locks={locks.filter(l => l.teamId === activeTeam.id)}
                teamLocked={teamLocks.some(t => t.teamId === activeTeam.id)}
                onSignup={handleSignupSlot}
                onEdit={handleEditSlot}
                onSetRole={handleSetRoleSlotClick}
              />
              {mutationError && (
                <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {mutationError}
                </div>
              )}
              {activeTeam.note && (
                <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/20 p-3">
                  <p className="text-xs font-medium text-amber-400 mb-1">团队备注</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{activeTeam.note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SignupModal
        open={signupSlot !== null}
        qq={qq}
        slotInfo={signupSlot !== null ? activeTeam?.slots[signupSlot] : null}
        teamId={activeTeam?.id}
        isAdminEditing={false}
        isBossSlot={signupSlot !== null && activeTeam ? activeTeam.config.reservedSlots.includes(signupSlot) : false}
        takenMartialArts={getTakenMartialArts()}
        onConfirm={(data, lockTimestamp) => { void handleSignupConfirm(data, lockTimestamp) }}
        onClose={() => setSignupSlot(null)}
      />

      {editSlot !== null && activeTeam && (() => {
        const existingMember = activeTeam.slots[editSlot]?.member ?? undefined
        const isOwnSlot = existingMember?.qq === qq
        const isAdminEdit = isAdmin && !isOwnSlot
        return (
          <SignupModal
            open={true}
            qq={isAdminEdit ? (existingMember?.qq ?? qq) : qq}
            existing={existingMember}
            slotInfo={activeTeam.slots[editSlot]}
            teamId={activeTeam.id}
            isBossSlot={activeTeam.config.reservedSlots.includes(editSlot)}
            isAdminEditing={isAdminEdit}
            takenMartialArts={getTakenMartialArts(editSlot)}
            onConfirm={(data, lockTimestamp) => { void handleSignupConfirm(data, lockTimestamp) }}
            onClose={() => setEditSlot(null)}
            onLeave={!isAdminEdit ? (lockTimestamp) => { void handleLeave(editSlot, lockTimestamp) } : undefined}
            onCancelMember={isAdminEdit ? () => { setCancelSlot(editSlot); setEditSlot(null) } : undefined}
          />
        )
      })()}

      <CancelModal
        open={cancelSlot !== null}
        memberName={cancelSlot !== null && activeTeam ? activeTeam.slots[cancelSlot]?.member?.characterId ?? '' : ''}
        qq={qq}
        teamId={activeTeam?.id}
        slotIndex={cancelSlot}
        onConfirm={(reason, lockTimestamp) => { void handleCancelConfirm(reason, lockTimestamp) }}
        onClose={() => setCancelSlot(null)}
      />

      {setRoleSlot !== null && activeTeam && (
        <SlotRolePicker
          open={true}
          slotIndex={setRoleSlot}
          currentRole={activeTeam.slots[setRoleSlot]?.fixedRole ?? null}
          currentMartialArt={activeTeam.slots[setRoleSlot]?.fixedMartialArtIndex ?? null}
          isReserved={activeTeam.slots[setRoleSlot]?.status === 'reserved'}
          canSignup={true}
          onSet={(role, maIdx, assignQQ) => { handleSetSlotRole(role, maIdx, assignQQ) }}
          onSignup={handleSignupFromRole}
          onClose={() => setSetRoleSlot(null)}
        />
      )}
      <CreateTeamDialog
        open={showCreateTeam}
        onConfirm={handleCreateTeam}
        onClose={() => setShowCreateTeam(false)}
      />
      <ThemeToggle />
    </>
  )
}

function LoginPage({ onLogin }: { onLogin: (qq: string) => void }) {
  const [inputQq, setInputQq] = useState('')
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = inputQq.trim()
    if (t) onLogin(t)
  }
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold text-foreground">兔扇报名助手</h1>
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <input
          type="text"
          className="flex h-10 rounded-md border border-input bg-transparent px-4 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-60"
          placeholder="输入QQ号登录/注册"
          value={inputQq}
          onChange={e => setInputQq(e.target.value)}
          autoFocus
        />
        <Button type="submit">进入</Button>
      </form>
    </div>
  )
}

export default App
