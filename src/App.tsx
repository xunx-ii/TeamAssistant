import { useState, useEffect, useCallback } from 'react'
import { loadAdminQQs } from './config'
import { initTheme } from './storage/theme'
import {
  getStoredQQ, setStoredQQ, removeStoredQQ,
  loadTeams, saveTeams,
  loadCancellations, saveCancellations,
  initServerMode, loadFromServer,
} from './storage'
import type { Member, Cancellation, Team } from './types'
import { createEmptySlots, generateId } from './types'
import { martialArts } from './data/martialArts'
import { fetchData, fetchLocks, fetchTeamLocks, lockTeam, unlockTeam, type SlotLock, type TeamLockInfo } from './api'
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
  const [notice, setNotice] = useState<Cancellation | null>(null)
  const [serverMode, setServerMode] = useState(false)
  const [locks, setLocks] = useState<SlotLock[]>([])
  const [teamLocks, setTeamLocks] = useState<TeamLockInfo[]>([])

  const isAdmin = qq ? adminQQs.includes(qq) : false
  const activeTeam = teams.find(t => t.id === activeTeamId) ?? teams[0]

  useEffect(() => {
    initServerMode().then(async (sm) => {
      setServerMode(sm)
      if (sm) {
        const ok = await loadFromServer()
        if (ok) {
          const loadedTeams = loadTeams()
          setTeams(loadedTeams)
          setCancellations(loadCancellations())
          if (loadedTeams.length > 0) {
            setActiveTeamId(loadedTeams[0].id)
          }
        } else {
          // Server is empty/new - push local data to server
          await saveTeams(teams)
          await saveCancellations(cancellations)
        }
      }
    })
  }, [])

  useEffect(() => { saveTeams(teams) }, [teams])
  useEffect(() => { saveCancellations(cancellations) }, [cancellations])
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
    let lastTeamsJson = ''
    const poll = async () => {
      const data = await fetchData()
      if (!data) return
      // Also update locks from data poll as fallback
      if (data.locks) setLocks(data.locks)
      const teamsJson = JSON.stringify(data.teams || [])
      if (teamsJson !== lastTeamsJson) {
        lastTeamsJson = teamsJson
        setTeams(data.teams || [])
      }
      if (data.cancellations) setCancellations(data.cancellations)
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [serverMode])

  useEffect(() => {
    if (!teams.find(t => t.id === activeTeamId) && teams.length > 0) {
      setActiveTeamId(teams[0].id)
    }
  }, [teams, activeTeamId])

  // Show cancellation notice when online (checked on login + every poll)
  useEffect(() => {
    if (qq) {
      const pending = cancellations.filter(c => c.qq === qq)
      if (pending.length > 0 && !notice) {
        setNotice(pending[0])
      }
    }
  }, [qq, cancellations, notice])

  const clearModals = () => {
    setSignupSlot(null); setEditSlot(null); setCancelSlot(null); setSetRoleSlot(null)
  }

  const switchTeam = (id: string) => { setActiveTeamId(id); clearModals() }

  const handleLogin = (userQq: string) => { setStoredQQ(userQq); setQq(userQq) }
  const handleLogout = () => { removeStoredQQ(); setQq(null); setNotice(null); clearModals() }

  const dismissNotice = () => {
    if (notice) {
      setCancellations(prev => prev.filter(c => !(c.qq === notice.qq && c.timestamp === notice.timestamp)))
      setNotice(null)
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

  const updateTeam = useCallback((id: string, updater: (t: Team) => Team) => {
    setTeams(prev => prev.map(t => t.id === id ? updater(t) : t))
  }, [])

  const handleAdminRename = useCallback((name: string) => {
    if (activeTeam) updateTeam(activeTeam.id, t => ({ ...t, name }))
  }, [activeTeam, updateTeam])

  const handleCreateTeam = (name: string) => {
    const team = createDefaultTeam(name.trim())
    setTeams(prev => [...prev, team])
    setActiveTeamId(team.id)
    clearModals()
    setShowCreateTeam(false)
  }

  const handleDeleteTeam = (id: string) => {
    if (!confirm('确定删除此团队？')) return
    setTeams(prev => {
      const next = prev.filter(t => t.id !== id)
      return next.length > 0 ? next : [createDefaultTeam()]
    })
  }

  const handleRenameTeam = (id: string, name: string) => {
    updateTeam(id, t => ({ ...t, name }))
  }

  const handleUpdateNote = (note: string) => {
    if (!activeTeam) return
    updateTeam(activeTeam.id, t => ({ ...t, note }))
  }

  const handleSetSlotRole = (role: 'T' | '治疗' | 'DPS' | 'boss' | null, martialArtIndex: number | null, assignQQ?: string) => {
    const slotIndex = setRoleSlot
    if (slotIndex === null || !activeTeam) return
    updateTeam(activeTeam.id, t => {
      let config = t.config
      const slots = t.slots.map(s => {
        if (s.index !== slotIndex) return s
        if (role === 'boss') {
          config = { ...t.config, reservedSlots: [...new Set([...config.reservedSlots, slotIndex])].sort((a, b) => a - b) }
          return { ...s, status: 'reserved' as const, member: null, fixedRole: null, fixedMartialArtIndex: null }
        }
        config = { ...t.config, reservedSlots: config.reservedSlots.filter(i => i !== slotIndex) }
        if (role === null) {
          return { ...s, status: 'empty' as const, member: null, fixedRole: null, fixedMartialArtIndex: null }
        }
        // If QQ is specified, directly occupy the slot
        if (assignQQ && martialArtIndex != null) {
          return {
            ...s,
            status: 'occupied' as const,
            fixedRole: null,
            fixedMartialArtIndex: null,
            member: {
              qq: assignQQ,
              martialArtIndex: String(martialArtIndex),
              gearScore: '',
              characterId: '',
              note: '',
            },
          }
        }
        return { ...s, status: 'fixed' as const, member: null, fixedRole: role, fixedMartialArtIndex: martialArtIndex }
      })
      return { ...t, config, slots }
    })
    setSetRoleSlot(null)
  }

  const handleQuickReserve = (type: 'T' | '治疗' | 'boss', count: number) => {
    if (!activeTeam) return
    updateTeam(activeTeam.id, t => {
      let slots = [...t.slots]
      let reserved = [...t.config.reservedSlots]
      const current = type === 'boss'
        ? reserved.length
        : slots.filter(s => s.status === 'fixed' && s.fixedRole === type).length

      if (type === 'boss') {
        if (count < current) {
          const toRemove = reserved.slice(current - count)
          reserved = reserved.filter(i => !toRemove.includes(i))
          slots = slots.map(s => toRemove.includes(s.index) ? { ...s, status: 'empty' as const, member: null, fixedRole: null, fixedMartialArtIndex: null } : s)
        } else {
          let need = count - current
          for (let i = 0; i < slots.length && need > 0; i++) {
            if (slots[i].status === 'empty' && !reserved.includes(i)) {
              reserved = [...reserved, i].sort((a, b) => a - b)
              slots[i] = { ...slots[i], status: 'reserved' as const, member: null, fixedRole: null, fixedMartialArtIndex: null }
              need--
            }
          }
        }
      } else {
        if (count < current) {
          const toRemove = slots.filter(s => s.status === 'fixed' && s.fixedRole === type).slice(0, current - count)
          slots = slots.map(s => toRemove.some(r => r.index === s.index) ? { ...s, status: 'empty' as const, member: null, fixedRole: null, fixedMartialArtIndex: null } : s)
        } else {
          let need = count - current
          for (let i = 0; i < slots.length && need > 0; i++) {
            if (slots[i].status === 'empty' && !reserved.includes(i)) {
              slots[i] = { ...slots[i], status: 'fixed' as const, member: null, fixedRole: type, fixedMartialArtIndex: null }
              need--
            }
          }
        }
      }
      return { ...t, slots, config: { ...t.config, reservedSlots: reserved } }
    })
  }

  const handleSignupConfirm = (data: Omit<Member, 'qq'>) => {
    const slotIndex = signupSlot ?? editSlot
    if (slotIndex === null || !qq || !activeTeam) return
    const originalQq = editSlot !== null ? activeTeam.slots[editSlot]?.member?.qq : null
    if (originalQq && originalQq !== qq && !isAdmin) return
    const member: Member = { qq: originalQq || qq, ...data }
    updateTeam(activeTeam.id, t => ({
      ...t,
      slots: t.slots.map(s => s.index === slotIndex ? { ...s, status: 'occupied' as const, member } : s),
    }))
    clearModals()
  }

  const handleCancelConfirm = (reason: string) => {
    if (cancelSlot === null || !qq || !activeTeam) return
    const slot = activeTeam.slots[cancelSlot]
    if (slot?.member) {
      setCancellations(prev => [...prev, {
        qq: slot.member!.qq, reason, cancelledBy: qq,
        teamId: activeTeam.id, teamName: activeTeam.name,
        slotIndex: cancelSlot, timestamp: Date.now(),
      }])
      updateTeam(activeTeam.id, t => ({
        ...t,
        slots: t.slots.map(s =>
          s.index === cancelSlot
            ? { ...s, status: s.fixedRole || s.fixedMartialArtIndex !== null ? 'fixed' as const : t.config.reservedSlots.includes(s.index) ? 'reserved' as const : 'empty' as const, member: null }
            : s
        ),
      }))
    }
    setCancelSlot(null)
  }

  const handleLeave = (slotIndex: number) => {
    if (!activeTeam) return
    updateTeam(activeTeam.id, t => ({
      ...t,
      slots: t.slots.map(s =>
        s.index === slotIndex
          ? { ...s, status: s.fixedRole || s.fixedMartialArtIndex !== null ? 'fixed' as const : t.config.reservedSlots.includes(s.index) ? 'reserved' as const : 'empty' as const, member: null }
          : s
      ),
    }))
    clearModals()
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
        <CancellationNotice open={!!notice} notice={notice} onDismiss={dismissNotice} />
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
            activeId={activeTeamId}
            isAdmin={isAdmin}
            onSwitch={switchTeam}
            onCreate={handleShowCreateTeam}
            onDelete={handleDeleteTeam}
            onRename={handleRenameTeam}
            onReorder={(ids) => {
              setTeams(prev => {
                const map = new Map(prev.map(t => [t.id, t]))
                return ids.map(id => map.get(id)!).filter(Boolean)
              })
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
                  onToggleLock={() => {
                    if (!activeTeam) return
                    const newLocked = !activeTeam.config.locked
                    updateTeam(activeTeam.id, t => ({
                      ...t,
                      config: { ...t.config, locked: newLocked },
                    }))
                    if (serverMode) {
                      (newLocked ? lockTeam : unlockTeam)(activeTeam.id)
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
        onConfirm={handleSignupConfirm}
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
            onConfirm={handleSignupConfirm}
            onClose={() => setEditSlot(null)}
            onLeave={!isAdminEdit ? () => handleLeave(editSlot) : undefined}
            onCancelMember={isAdminEdit ? () => { setCancelSlot(editSlot); setEditSlot(null) } : undefined}
          />
        )
      })()}

      <CancelModal
        open={cancelSlot !== null}
        memberName={cancelSlot !== null && activeTeam ? activeTeam.slots[cancelSlot]?.member?.characterId ?? '' : ''}
        onConfirm={handleCancelConfirm}
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
