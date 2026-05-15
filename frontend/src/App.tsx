import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { loadAdminQQs } from './config'
import { initTheme } from './storage/theme'
import {
  getStoredQQ, setStoredQQ, removeStoredQQ,
  loadTeams, saveTeams, setTeamsLocal,
  loadCancellations, setCancellationsLocal,
  loadArchivedTeams, setArchivedTeamsLocal,
  loadOperationLogs, setOperationLogsLocal,
  loadUserProfiles, setUserProfilesLocal,
  initServerMode, normalizeServerData,
} from './storage'
import type { ArchivedTeam, Member, Cancellation, OperationLog, Team, SubsidyType, MemberSubsidySelection, SubsidyTarget, UserProfiles } from './types'
import { martialArts } from './data/martialArts'
import { fetchServerChanges, fetchServerVersion, mutateData, subscribeServerEvents, type LockState, type MutationResult, type ServerData, type ServerEvent, type SlotLock, type TeamLockInfo } from './api'
import { applyMutation, type Mutation, type Snapshot } from './dataStore'
import { normalizeTeamName } from './teamName'
import { hasNonTextTransfer, normalizeTextInput, sanitizeIntegerInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from './textInput'
import { createSubsidyTargets, getSubsidyRegistrationTargets } from './subsidy'
import { loadSubsidyPresets, saveSubsidyPresets } from './subsidyPresets'
import { createDefaultTeam, createTeamFromGuide, type CreateTeamGuideValues } from './teamCreation'
import { getCurrentWeekStartKey } from './week'
import { startAdaptivePoll } from './polling'
import { TeamTabs } from './components/TeamTabs'
import { AdminConfig } from './components/AdminConfig'
import { SubsidyConfigDialog } from './components/SubsidyConfig'
import { SubsidyModal } from './components/SubsidyModal'
import { SubsidyStats } from './components/SubsidyStats'
import { PresetSubsidyDialog } from './components/PresetSubsidyDialog'
import { BackupSettingsDialog } from './components/BackupSettingsDialog'
import { SlotGrid } from './components/SlotGrid'
import { SlotRolePicker } from './components/SlotRolePicker'
import { SignupModal } from './components/SignupModal'
import { CancelModal } from './components/CancelModal'
import { CancellationNotice } from './components/CancellationNotice'
import { CreateTeamDialog } from './components/CreateTeamDialog'
import { ArchiveDialog } from './components/ArchiveDialog'
import { OperationLogDialog } from './components/OperationLogDialog'
import { NicknameDialog } from './components/NicknameDialog'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog'
import { useImeSafeInputHandlers } from './components/ui/imeInput'
import { PixelHeart, PixelStar, PixelCarrot } from './components/PixelRabbit'

function findPendingNotice(qq: string | null, cancellations: Cancellation[]) {
  if (!qq) return null
  return cancellations.find(item => item.qq === qq) ?? null
}

interface AppConfirmOptions {
  title: string
  message: string
  confirmText: string
  cancelText: string
  destructive?: boolean
}

const LOADING_MESSAGES = [
  '正在猛猛敲门...',
  '别急，团长还在找钥匙开门...',
  '门好像卡住了，正在用力推...',
  '门坏了！正在砸门...',
  '快开门！你们在里面干嘛！！！',
]

function pickLoadingMessage() {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)] ?? LOADING_MESSAGES[0]
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
  const [archivedTeams, setArchivedTeams] = useState<ArchivedTeam[]>(loadArchivedTeams)
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>(loadOperationLogs)
  const [userProfiles, setUserProfiles] = useState<UserProfiles>(loadUserProfiles)
  const [adminQQs, setAdminQQs] = useState<string[]>([])
  const [subsidyPresets, setSubsidyPresets] = useState<SubsidyType[]>(loadSubsidyPresets)

  const [signupSlot, setSignupSlot] = useState<number | null>(null)
  const [editSlot, setEditSlot] = useState<number | null>(null)
  const [cancelSlot, setCancelSlot] = useState<number | null>(null)
  const [setRoleSlot, setSetRoleSlot] = useState<number | null>(null)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showArchives, setShowArchives] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showSubsidy, setShowSubsidy] = useState(false)
  const [showSubsidyConfig, setShowSubsidyConfig] = useState(false)
  const [showSubsidyStats, setShowSubsidyStats] = useState(false)
  const [showSubsidyPreset, setShowSubsidyPreset] = useState(false)
  const [showBackupSettings, setShowBackupSettings] = useState(false)
  const [showNicknameDialog, setShowNicknameDialog] = useState(false)
  const [nicknameError, setNicknameError] = useState('')
  const [serverMode, setServerMode] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [showLoadingTransition, setShowLoadingTransition] = useState(true)
  const [loadingMessage] = useState(pickLoadingMessage)
  const [locks, setLocks] = useState<SlotLock[]>([])
  const [teamLocks, setTeamLocks] = useState<TeamLockInfo[]>([])
  const [mutationError, setMutationError] = useState('')
  const [confirmOptions, setConfirmOptions] = useState<AppConfirmOptions | null>(null)
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null)
  const dataVersionRef = useRef<number | null>(null)
  const lockVersionRef = useRef<number | null>(null)
  const syncingChangesRef = useRef(false)
  const pendingServerEventRef = useRef<ServerEvent | null>(null)

  const isAdmin = qq ? adminQQs.includes(qq) : false
  const activeTeamExists = teams.some(t => t.id === activeTeamId)
  const resolvedActiveTeamId = activeTeamExists ? activeTeamId : (teams[0]?.id ?? '')
  const activeTeam = teams.find(t => t.id === resolvedActiveTeamId) ?? teams[0]
  const notice = findPendingNotice(qq, cancellations)
  const currentWeekStart = getCurrentWeekStartKey()
  const currentNickname = qq ? (userProfiles[qq]?.nickname ?? '') : ''
  const requiresNickname = Boolean(qq) && !currentNickname
  const subsidyTargets = useMemo(() => createSubsidyTargets(teams, archivedTeams, qq, currentWeekStart), [teams, archivedTeams, qq, currentWeekStart])
  const subsidyRegistrationTargets = useMemo(
    () => getSubsidyRegistrationTargets(subsidyTargets, currentWeekStart),
    [subsidyTargets, currentWeekStart],
  )

  const syncSnapshot = useCallback((snapshot: Snapshot) => {
    const nextTeams = snapshot.teams ?? []
    const nextCancellations = snapshot.cancellations ?? []
    const nextArchivedTeams = snapshot.archivedTeams ?? []
    const nextLogs = snapshot.logs ?? []
    const nextUserProfiles = snapshot.userProfiles ?? {}
    setTeams(nextTeams)
    setCancellations(nextCancellations)
    setArchivedTeams(nextArchivedTeams)
    setOperationLogs(nextLogs)
    setUserProfiles(nextUserProfiles)
    setTeamsLocal(nextTeams)
    setCancellationsLocal(nextCancellations)
    setArchivedTeamsLocal(nextArchivedTeams)
    setOperationLogsLocal(nextLogs)
    setUserProfilesLocal(nextUserProfiles)
  }, [])

  const syncSubsidyPresets = useCallback((presets: SubsidyType[]) => {
    setSubsidyPresets(presets)
    saveSubsidyPresets(presets)
  }, [])

  const syncServerData = useCallback((data: ServerData) => {
    const snapshot = normalizeServerData(data)
    if (Array.isArray(data.subsidyPresets)) {
      syncSubsidyPresets(data.subsidyPresets)
    }
    if (snapshot.teams.length === 0) return false
    const incomingLockVersion = typeof data.lockVersion === 'number' ? data.lockVersion : null
    const canApplyLocks = incomingLockVersion === null || lockVersionRef.current === null || incomingLockVersion >= lockVersionRef.current
    if (canApplyLocks && data.locks) setLocks(data.locks)
    if (canApplyLocks && data.teamLocks) setTeamLocks(data.teamLocks)
    if (typeof data.dataVersion === 'number') dataVersionRef.current = data.dataVersion
    if (typeof data.lockVersion === 'number' && canApplyLocks) lockVersionRef.current = data.lockVersion
    syncSnapshot(snapshot)
    return true
  }, [syncSnapshot, syncSubsidyPresets])

  const syncLockState = useCallback((state: LockState) => {
    if (
      typeof state.lockVersion === 'number' &&
      typeof lockVersionRef.current === 'number' &&
      state.lockVersion < lockVersionRef.current
    ) {
      return
    }
    setLocks(state.slots)
    setTeamLocks(state.teams)
    if (typeof state.lockVersion === 'number') lockVersionRef.current = state.lockVersion
  }, [])

  const applyAcquiredSlotLock = useCallback((lock: SlotLock & { lockVersion?: number }) => {
    setLocks(current => {
      const withoutSlot = current.filter(item => item.teamId !== lock.teamId || item.slotIndex !== lock.slotIndex)
      return [...withoutSlot, {
        teamId: lock.teamId,
        slotIndex: lock.slotIndex,
        qq: lock.qq,
        timestamp: lock.timestamp,
      }]
    })
    if (typeof lock.lockVersion === 'number') lockVersionRef.current = lock.lockVersion
  }, [])

  const applyReleasedSlotLock = useCallback((lock: { teamId: string; slotIndex: number; qq: string; timestamp?: number }) => {
    setLocks(current => current.filter(item => (
      item.teamId !== lock.teamId ||
      item.slotIndex !== lock.slotIndex ||
      item.qq !== lock.qq ||
      (typeof lock.timestamp === 'number' && item.timestamp !== lock.timestamp)
    )))
  }, [])

  const syncServerChanges = useCallback(async (event?: ServerEvent | null) => {
    if (syncingChangesRef.current) {
      if (event) pendingServerEventRef.current = event
      return true
    }
    syncingChangesRef.current = true
    try {
      let nextEvent = event ?? pendingServerEventRef.current
      pendingServerEventRef.current = null

      do {
        if (
          nextEvent &&
          dataVersionRef.current === nextEvent.dataVersion &&
          lockVersionRef.current === nextEvent.lockVersion
        ) {
          nextEvent = pendingServerEventRef.current
          pendingServerEventRef.current = null
          continue
        }

        const changes = await fetchServerChanges(dataVersionRef.current, lockVersionRef.current)
        if (!changes) return false

        let synced = true
        if (changes.data) {
          synced = syncServerData(changes.data)
        } else {
          dataVersionRef.current = changes.dataVersion
        }
        if (changes.locks) {
          syncLockState(changes.locks)
        } else {
          lockVersionRef.current = changes.lockVersion
        }
        if (!synced) return false

        nextEvent = pendingServerEventRef.current
        pendingServerEventRef.current = null
      } while (nextEvent)

      return true
    } finally {
      syncingChangesRef.current = false
    }
  }, [syncLockState, syncServerData])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      const [sm, admins] = await Promise.all([
        initServerMode(),
        loadAdminQQs(),
      ])
      if (!active) return
      setAdminQQs(admins)
      if (sm) {
        const changes = await fetchServerChanges(dataVersionRef.current, lockVersionRef.current)
        if (!active) return
        const loadedData = changes?.data ?? null
        if (loadedData && syncServerData(loadedData)) {
          const loadedTeams = loadTeams()
          const loadedCancellations = loadCancellations()
          const loadedArchivedTeams = loadArchivedTeams()
          const loadedLogs = loadOperationLogs()
          syncSnapshot({
            teams: loadedTeams,
            cancellations: loadedCancellations,
            archivedTeams: loadedArchivedTeams,
            logs: loadedLogs,
            userProfiles: loadUserProfiles(),
          })
          if (loadedTeams.length > 0) {
            setActiveTeamId(loadedTeams[0].id)
          }
        } else if (loadedData && normalizeServerData(loadedData).teams.length === 0) {
          await saveTeams(loadTeams())
        }
      }
      if (!active) return
      setServerMode(sm)
      setInitializing(false)
    }
    initialize().catch(() => {
      if (!active) return
      setServerMode(false)
      setInitializing(false)
    })
    return () => {
      active = false
    }
  }, [syncSnapshot, syncServerData])

  useEffect(() => { initTheme() }, [])

  useEffect(() => {
    if (!serverMode) return
    const unsubscribe = subscribeServerEvents(event => {
      pendingServerEventRef.current = event
      void syncServerChanges(event)
    })
    const poll = async () => {
      if (pendingServerEventRef.current) {
        return syncServerChanges()
      }
      const version = await fetchServerVersion()
      if (!version) return false
      if (
        dataVersionRef.current === version.dataVersion &&
        lockVersionRef.current === version.lockVersion
      ) {
        return true
      }
      return syncServerChanges(version)
    }
    const controller = startAdaptivePoll(poll, {
      baseDelayMs: unsubscribe ? 10_000 : 2_000,
      hiddenDelayMs: 15_000,
      maxDelayMs: 20_000,
    })
    return () => {
      unsubscribe?.()
      controller.stop()
    }
  }, [serverMode, syncServerChanges])

  const clearModals = () => {
    setSignupSlot(null); setEditSlot(null); setCancelSlot(null); setSetRoleSlot(null)
  }

  const applyLocalMutation = useCallback((mutation: Mutation) => {
    const next = applyMutation({ teams, cancellations, archivedTeams, logs: operationLogs, userProfiles }, mutation)
    syncSnapshot(next)
    return next
  }, [teams, cancellations, archivedTeams, operationLogs, userProfiles, syncSnapshot])

  const runMutation = useCallback(async (mutation: Mutation): Promise<MutationResult> => {
    setMutationError('')
    if (!serverMode) {
      applyLocalMutation(mutation)
      return { ok: true }
    }

    const result = await mutateData(mutation)
    if (result.ok) {
      if (result.data) {
        syncServerData(result.data)
      } else {
        applyLocalMutation(mutation)
        if (typeof result.dataVersion === 'number') dataVersionRef.current = result.dataVersion
        if (typeof result.lockVersion === 'number') lockVersionRef.current = result.lockVersion
      }
      if (
        (mutation.type === 'signupSlot' || mutation.type === 'cancelSlot' || mutation.type === 'leaveSlot') &&
        typeof mutation.lockTimestamp === 'number'
      ) {
        applyReleasedSlotLock({
          teamId: mutation.teamId,
          slotIndex: mutation.slotIndex,
          qq: mutation.type === 'signupSlot' ? (mutation.actorQq ?? mutation.member.qq) : (mutation.actorQq ?? qq ?? ''),
          timestamp: mutation.lockTimestamp,
        })
      }
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
  }, [applyLocalMutation, applyReleasedSlotLock, qq, serverMode, syncServerData])

  const switchTeam = (id: string) => { setActiveTeamId(id); clearModals(); setMutationError('') }
  const handleBackupRestored = (data: ServerData) => {
    const snapshot = normalizeServerData(data)
    syncSnapshot(snapshot)
    if (Array.isArray(data.subsidyPresets)) {
      syncSubsidyPresets(data.subsidyPresets)
    }
    setActiveTeamId(snapshot.teams[0]?.id ?? '')
    clearModals()
  }

  const resolveConfirm = useCallback((confirmed: boolean) => {
    confirmResolveRef.current?.(confirmed)
    confirmResolveRef.current = null
    setConfirmOptions(null)
  }, [])

  const requestConfirm = useCallback((options: AppConfirmOptions) => {
    confirmResolveRef.current?.(false)
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOptions(options)
    })
  }, [])

  const handleLogin = (userQq: string) => { setStoredQQ(userQq); setQq(userQq) }
  const handleLogout = () => { removeStoredQQ(); setQq(null); setShowNicknameDialog(false); setNicknameError(''); setMutationError(''); clearModals() }

  const handleSaveNickname = async (nickname: string) => {
    if (!qq) return
    setNicknameError('')
    if (currentNickname === nickname) {
      setShowNicknameDialog(false)
      return
    }
    const result = await runMutation({ type: 'updateNickname', qq, nickname })
    if (result.ok) {
      setShowNicknameDialog(false)
      return
    }
    setNicknameError(result.error || '昵称保存失败，请稍后再试')
  }

  const dismissNotice = async () => {
    if (notice) {
      await runMutation({ type: 'dismissCancellation', qq: notice.qq, timestamp: notice.timestamp })
    }
  }

  const handleShowCreateTeam = useCallback(() => setShowCreateTeam(true), [])
  const handleSignupSlot = useCallback((idx: number) => setSignupSlot(idx), [])
  const handleEditSlot = useCallback((idx: number) => setEditSlot(idx), [])
  const handleViewSlot = useCallback((idx: number) => setEditSlot(idx), [])
  const handleSetRoleSlotClick = useCallback((idx: number) => setSetRoleSlot(idx), [])
  const handleSignupFromRole = useCallback(() => {
    if (setRoleSlot !== null) {
      setSignupSlot(setRoleSlot)
      setSetRoleSlot(null)
    }
  }, [setRoleSlot])

  const handleAdminRename = useCallback((name: string) => {
    if (activeTeam) {
      const normalizedName = normalizeTeamName(normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName }), activeTeam.name)
      void runMutation({ type: 'renameTeam', teamId: activeTeam.id, name: normalizedName })
    }
  }, [activeTeam, runMutation])

  const handleCreateTeam = async (values: CreateTeamGuideValues) => {
    const team = createTeamFromGuide(values, subsidyPresets)
    const result = await runMutation({ type: 'createTeam', team })
    if (result.ok) {
      setActiveTeamId(team.id)
      clearModals()
      setShowCreateTeam(false)
    }
  }

  const handleArchiveTeam = async () => {
    const team = activeTeam
    if (!team || !qq) return
    const shouldArchive = await requestConfirm({
      title: '归档表格',
      message: `确定归档「${team.name}」？`,
      confirmText: '归档',
      cancelText: '取消',
      destructive: true,
    })
    if (!shouldArchive) return
    const remaining = teams.filter(item => item.id !== team.id)
    const fallbackTeam = remaining.length > 0 ? undefined : createDefaultTeam()
    const result = await runMutation({
      type: 'archiveTeam',
      teamId: team.id,
      archivedBy: qq,
      fallbackTeam,
    })
    if (result.ok) {
      setActiveTeamId(remaining[0]?.id ?? fallbackTeam?.id ?? '')
      clearModals()
    }
  }

  const handleRestoreArchive = async (archiveId: string) => {
    if (!qq) return
    const archive = archivedTeams.find(item => item.id === archiveId)
    const result = await runMutation({ type: 'restoreArchivedTeam', archiveId, actorQq: qq })
    if (result.ok && archive) {
      setActiveTeamId(archive.team.id)
      setShowArchives(false)
      clearModals()
    }
  }

  const handleDeleteTeam = async (id: string) => {
    const team = teams.find(item => item.id === id)
    const shouldDelete = await requestConfirm({
      title: '删除团队',
      message: team ? `确定删除「${team.name}」？` : '确定删除此团队？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    })
    if (!shouldDelete) return
    const remaining = teams.filter(item => item.id !== id)
    const fallbackTeam = remaining.length > 0 ? undefined : createDefaultTeam()
    const result = await runMutation({ type: 'deleteTeam', teamId: id, fallbackTeam })
    if (result.ok && resolvedActiveTeamId === id) {
      const nextActive = remaining[0]?.id ?? fallbackTeam?.id ?? ''
      setActiveTeamId(nextActive)
    }
  }

  const handleRenameTeam = (id: string, name: string) => {
    const currentName = teams.find(team => team.id === id)?.name ?? '默认团队'
    const teamName = normalizeTextInput(name, { maxLength: TEXT_INPUT_LIMITS.teamName })
    void runMutation({ type: 'renameTeam', teamId: id, name: normalizeTeamName(teamName, currentName) })
  }

  const handleUpdateNote = (note: string) => {
    if (!activeTeam) return
    const textNote = sanitizeTextInput(note, { maxLength: TEXT_INPUT_LIMITS.note, multiline: true })
    void runMutation({ type: 'updateTeamNote', teamId: activeTeam.id, note: textNote })
  }

  const handleUpdateWeekStart = (weekStart: string) => {
    if (!activeTeam) return
    void runMutation({ type: 'updateTeamWeekStart', teamId: activeTeam.id, weekStart })
  }

  const handleSetSlotRole = async (role: 'T' | '治疗' | 'DPS' | 'boss' | null, martialArtIndex: number | null, assignQQ?: string) => {
    const slotIndex = setRoleSlot
    if (slotIndex === null || !activeTeam) return
    const assignedQq = normalizeTextInput(assignQQ ?? '', { maxLength: TEXT_INPUT_LIMITS.qq }) || undefined
    const result = await runMutation({
      type: 'setSlotRole',
      teamId: activeTeam.id,
      slotIndex,
      role,
      martialArtIndex,
      assignQQ: assignedQq,
      actorQq: qq ?? undefined,
    })
    if (result.ok) {
      setSetRoleSlot(null)
    }
  }

  const handleQuickReserve = (type: 'T' | '治疗' | 'boss', count: number) => {
    if (!activeTeam) return
    void runMutation({ type: 'quickReserve', teamId: activeTeam.id, reserveType: type, count })
  }

  const handleSaveSubsidyTypes = (subsidyTypes: SubsidyType[]) => {
    if (!activeTeam) return
    const textSubsidyTypes = subsidyTypes.map(type => ({
      ...type,
      name: normalizeTextInput(type.name, { maxLength: TEXT_INPUT_LIMITS.subsidyName }),
      levels: type.levels
        .map(level => ({
          ...level,
          name: normalizeTextInput(level.name, { maxLength: TEXT_INPUT_LIMITS.subsidyLevelName }),
        }))
        .filter(level => level.name),
    })).filter(type => type.name && type.levels.length > 0)
    void runMutation({ type: 'updateTeamSubsidyTypes', teamId: activeTeam.id, subsidyTypes: textSubsidyTypes })
  }

  const handleRegisterSubsidies = (target: SubsidyTarget, selections: MemberSubsidySelection[]) => {
    if (!qq) return
    if (target.weekStart !== currentWeekStart) return
    void runMutation({
      type: 'registerMemberSubsidies',
      teamId: target.teamId,
      archiveId: target.archiveId,
      qq,
      selections,
      weekStart: target.weekStart,
    })
  }

  const handleSignupConfirm = async (data: Omit<Member, 'qq'>, lockTimestamp?: number) => {
    const slotIndex = signupSlot ?? editSlot
    if (slotIndex === null || !qq || !activeTeam) return
    const originalQq = editSlot !== null ? activeTeam.slots[editSlot]?.member?.qq : null
    if (originalQq && originalQq !== qq && !isAdmin) return
    const memberQq = originalQq || qq
    const fallbackNickname = normalizeTextInput(userProfiles[memberQq]?.nickname ?? '', { maxLength: TEXT_INPUT_LIMITS.characterId })
    const memberData: Omit<Member, 'qq'> = {
      martialArtIndex: sanitizeIntegerInput(data.martialArtIndex, 3),
      gearScore: sanitizeIntegerInput(data.gearScore, TEXT_INPUT_LIMITS.gearScore),
      characterId: normalizeTextInput(data.characterId, { maxLength: TEXT_INPUT_LIMITS.characterId }) || fallbackNickname,
      note: normalizeTextInput(data.note, { maxLength: TEXT_INPUT_LIMITS.note }),
      hasOrangeWeapon: data.hasOrangeWeapon,
    }
    if (!memberData.martialArtIndex || !memberData.gearScore || !memberData.characterId) return
    const member: Member = { qq: memberQq, ...memberData }
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
    const textReason = normalizeTextInput(reason, { maxLength: TEXT_INPUT_LIMITS.cancelReason, multiline: true })
    if (!textReason) return
    const slot = activeTeam.slots[cancelSlot]
    if (slot?.member) {
      const result = await runMutation({
        type: 'cancelSlot',
        teamId: activeTeam.id,
        slotIndex: cancelSlot,
        reason: textReason,
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

  const handleLeave = useCallback(async (slotIndex: number, lockTimestamp?: number) => {
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
  }, [activeTeam, qq, runMutation])

  const handleEditSlotLeave = useCallback((lockTimestamp?: number) => {
    if (editSlot === null) return
    void handleLeave(editSlot, lockTimestamp)
  }, [editSlot, handleLeave])

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

  const loadingOverlay = showLoadingTransition ? (
    <div
      className={`loading-transition ${initializing ? '' : 'loading-transition-exit'}`}
      onAnimationEnd={(event) => {
        if (!initializing && event.currentTarget === event.target) {
          setShowLoadingTransition(false)
        }
      }}
    >
      <div className="loading-backdrop" />
      <div className="loading-pixel-gate loading-pixel-gate-left" />
      <div className="loading-pixel-gate loading-pixel-gate-right" />
      <div className="loading-scanline" />
      <div className="loading-core">
        <div className="loading-stars" aria-hidden="true">
          <PixelStar size={14} />
          <PixelHeart size={16} />
          <PixelStar size={14} />
        </div>
        <div className="loading-rabbit" aria-hidden="true">
          <PixelCarrot size={34} />
        </div>
        <div className="pixel-card loading-card">
          {loadingMessage}
        </div>
      </div>
    </div>
  ) : null

  if (initializing) {
    return <>{loadingOverlay}</>
  }

  if (!qq) {
    return (
      <>
        <div className="app-enter">
          <LoginPage onLogin={handleLogin} />
        </div>
        {loadingOverlay}
      </>
    )
  }

  return (
    <>
      {notice && (
        <CancellationNotice open={!!notice} notice={notice} onDismiss={() => { void dismissNotice() }} />
      )}
      <div className="min-h-screen bg-background pixel-bg-pattern app-enter">
        {/* Decorative floating elements */}
        <div className="fixed top-20 left-4 opacity-20 pointer-events-none pixel-carrot-float hidden lg:block">
          <PixelCarrot size={32} />
        </div>
        <div className="fixed top-40 right-8 opacity-20 pointer-events-none pixel-heart-float hidden lg:block">
          <PixelHeart size={28} />
        </div>
        <div className="fixed bottom-32 left-8 opacity-20 pointer-events-none pixel-star-float hidden lg:block">
          <PixelStar size={24} />
        </div>
        <div className="fixed bottom-20 right-16 opacity-15 pointer-events-none pixel-carrot-float hidden lg:block" style={{ animationDelay: '1.5s' }}>
          <PixelCarrot size={20} />
        </div>

        <div className="max-w-[960px] mx-auto px-4 py-5">
          {/* Header */}
          <div className="pixel-card p-3">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-bold text-foreground pixel-font">兔扇报名助手</h1>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {isAdmin && (
                  <span className="pixel-badge bg-amber-100 text-amber-700">
                    GM
                  </span>
                )}
                {isAdmin && (
                  <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={() => setShowBackupSettings(true)} disabled={!serverMode}>
                    备份设置
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={() => setShowSubsidyPreset(true)}>
                    补贴预设
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={() => setShowArchives(true)}>
                    查看档案
                  </Button>
                )}
                <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={() => setShowSubsidy(true)}>
                  补贴登记
                </Button>
                <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={() => setShowSubsidyStats(true)}>
                  补贴统计
                </Button>
                {serverMode && (
                  <span className="pixel-badge bg-blue-100 text-blue-700">
                    SYNC
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="pixel-btn max-w-[160px] truncate text-xs"
                  onClick={() => {
                    setNicknameError('')
                    setShowNicknameDialog(true)
                  }}
                >
                  {currentNickname || '设置昵称'}
                </Button>
                <Button variant="outline" size="sm" className="pixel-btn text-xs" onClick={handleLogout}>登出</Button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-3">
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
          </div>

          {activeTeam && (
            <div className="mt-4">
              {isAdmin && (
                <AdminConfig
                  teamName={activeTeam.name}
                  weekStart={activeTeam.weekStart ?? currentWeekStart}
                  note={activeTeam.note}
                  serverMode={serverMode}
                  locked={activeTeam.config.locked}
                  onRename={handleAdminRename}
                  onSaveWeekStart={handleUpdateWeekStart}
                  onUpdateNote={handleUpdateNote}
                  onQuickReserve={handleQuickReserve}
                  onToggleLock={async () => {
                    if (!activeTeam) return
                    const newLocked = !activeTeam.config.locked
                    await runMutation({ type: 'setTeamLockState', teamId: activeTeam.id, locked: newLocked })
                  }}
                  onViewLogs={() => setShowLogs(true)}
                  onArchive={handleArchiveTeam}
                  onOpenSubsidyConfig={() => setShowSubsidyConfig(true)}
                />
              )}
              <div className="mb-3 pixel-card p-3">
                <div className="flex items-center gap-2">
                  <PixelHeart size={16} />
                  <h2 className="text-sm font-bold text-foreground break-all">{activeTeam.name}</h2>
                </div>
              </div>
              <SlotGrid
                slots={activeTeam.slots}
                config={activeTeam.config}
                currentQQ={qq}
                userProfiles={userProfiles}
                isAdmin={isAdmin}
                locks={locks.filter(l => l.teamId === activeTeam.id)}
                teamLocked={teamLocks.some(t => t.teamId === activeTeam.id)}
                onSignup={handleSignupSlot}
                onEdit={handleEditSlot}
                onSetRole={handleSetRoleSlotClick}
                onView={handleViewSlot}
              />
              {mutationError && (
                <div className="mt-3 pixel-notification bg-red-50 px-3 py-2 text-xs text-red-600">
                  ⚠️ {mutationError}
                </div>
              )}
              {activeTeam.note && (
                <div className="mt-4 pixel-card p-3 border-l-4 border-l-amber-400">
                  <div className="flex items-center gap-2 mb-1">
                    <PixelCarrot size={16} />
                    <p className="text-xs font-bold text-amber-600 pixel-font" style={{ fontSize: '10px' }}>团队备注</p>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{activeTeam.note}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SignupModal
        key={`signup-${activeTeam?.id ?? 'none'}-${signupSlot ?? 'none'}`}
        open={signupSlot !== null}
        qq={qq}
        nickname={currentNickname}
        slotInfo={signupSlot !== null ? activeTeam?.slots[signupSlot] : null}
        teamId={activeTeam?.id}
        requireLock={serverMode}
        isAdminEditing={false}
        isBossSlot={signupSlot !== null && activeTeam ? activeTeam.config.reservedSlots.includes(signupSlot) : false}
        takenMartialArts={getTakenMartialArts()}
        onConfirm={handleSignupConfirm}
        onClose={() => setSignupSlot(null)}
        onLockAcquired={applyAcquiredSlotLock}
        onLockReleased={applyReleasedSlotLock}
      />

      {editSlot !== null && activeTeam && (() => {
        const editSlotIndex = editSlot
        const existingMember = activeTeam.slots[editSlot]?.member ?? undefined
        const isOwnSlot = existingMember?.qq === qq
        const isAdminEdit = isAdmin && !isOwnSlot
        const isViewOnly = !!existingMember && !isOwnSlot && !isAdmin
        const modalQq = isViewOnly ? (existingMember?.qq ?? qq) : (isAdminEdit ? (existingMember?.qq ?? qq) : qq)
        return (
          <SignupModal
            key={`edit-${activeTeam.id}-${editSlot}-${existingMember?.qq ?? 'empty'}-${existingMember?.martialArtIndex ?? 'none'}`}
            open={true}
            qq={modalQq}
            nickname={userProfiles[modalQq]?.nickname}
            lockOwnerQq={isAdminEdit ? qq : undefined}
            existing={existingMember}
            slotInfo={activeTeam.slots[editSlot]}
            teamId={activeTeam.id}
            requireLock={serverMode}
            isBossSlot={activeTeam.config.reservedSlots.includes(editSlot)}
            isAdminEditing={isAdminEdit}
            readOnly={isViewOnly}
            takenMartialArts={getTakenMartialArts(editSlot)}
            onConfirm={handleSignupConfirm}
            onClose={() => setEditSlot(null)}
            onLockAcquired={applyAcquiredSlotLock}
            onLockReleased={applyReleasedSlotLock}
            onLeave={!isAdminEdit ? handleEditSlotLeave : undefined}
            onCancelMember={isAdminEdit ? () => { setCancelSlot(editSlotIndex); setEditSlot(null) } : undefined}
          />
        )
      })()}

      <CancelModal
        open={cancelSlot !== null}
        memberName={cancelSlot !== null && activeTeam ? activeTeam.slots[cancelSlot]?.member?.characterId ?? '' : ''}
        qq={qq}
        teamId={activeTeam?.id}
        slotIndex={cancelSlot}
        requireLock={serverMode}
        onConfirm={(reason, lockTimestamp) => { void handleCancelConfirm(reason, lockTimestamp) }}
        onClose={() => setCancelSlot(null)}
        onLockAcquired={applyAcquiredSlotLock}
        onLockReleased={applyReleasedSlotLock}
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
      {showCreateTeam && (
        <CreateTeamDialog
          subsidyPresets={subsidyPresets}
          open={showCreateTeam}
          onConfirm={handleCreateTeam}
          onClose={() => setShowCreateTeam(false)}
        />
      )}
      <OperationLogDialog
        open={showLogs}
        teamName={activeTeam?.name ?? ''}
        logs={activeTeam ? operationLogs.filter(log => log.teamId === activeTeam.id || !log.teamId) : operationLogs.filter(log => !log.teamId)}
        onClose={() => setShowLogs(false)}
      />
      <ArchiveDialog
        open={showArchives}
        archives={archivedTeams}
        onRestore={(archiveId) => { void handleRestoreArchive(archiveId) }}
        onClose={() => setShowArchives(false)}
      />
      {showSubsidy && (
        <SubsidyModal
          key={`subsidy-modal-${activeTeam?.id ?? 'none'}`}
          open={showSubsidy}
          targets={subsidyRegistrationTargets}
          onConfirm={handleRegisterSubsidies}
          onClose={() => setShowSubsidy(false)}
        />
      )}
      {showSubsidyConfig && (
        <SubsidyConfigDialog
          subsidyPresets={subsidyPresets}
          key={`subsidy-config-${activeTeam?.id ?? 'none'}`}
          open={showSubsidyConfig}
          subsidyTypes={activeTeam?.subsidyTypes || []}
          onSave={handleSaveSubsidyTypes}
          onClose={() => setShowSubsidyConfig(false)}
        />
      )}
      <SubsidyStats
        key={`subsidy-stats-${activeTeam?.id ?? 'none'}`}
        open={showSubsidyStats}
        targets={subsidyTargets}
        userProfiles={userProfiles}
        onClose={() => setShowSubsidyStats(false)}
      />
      <NicknameDialog
        open={showNicknameDialog || requiresNickname}
        qq={qq}
        nickname={currentNickname}
        required={requiresNickname}
        errorMessage={nicknameError}
        onConfirm={(nickname) => { void handleSaveNickname(nickname) }}
        onClose={() => {
          setNicknameError('')
          setShowNicknameDialog(false)
        }}
        onLogout={handleLogout}
      />
      <PresetSubsidyDialog
        open={showSubsidyPreset}
        serverMode={serverMode}
        subsidyPresets={subsidyPresets}
        onSaved={setSubsidyPresets}
        onClose={() => setShowSubsidyPreset(false)}
      />
      <BackupSettingsDialog
        open={showBackupSettings}
        onRestored={handleBackupRestored}
        onClose={() => setShowBackupSettings(false)}
      />
      <Dialog open={!!confirmOptions} onOpenChange={(value) => { if (!value) resolveConfirm(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{confirmOptions?.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {confirmOptions?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resolveConfirm(false)}
            >
              {confirmOptions?.cancelText}
            </Button>
            <Button
              type="button"
              variant={confirmOptions?.destructive ? 'destructive' : 'default'}
              size="sm"
              onClick={() => resolveConfirm(true)}
            >
              {confirmOptions?.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {loadingOverlay}
    </>
  )
}

function LoginPage({ onLogin }: { onLogin: (qq: string) => void }) {
  const [inputQq, setInputQq] = useState('')
  const qqInputHandlers = useImeSafeInputHandlers<HTMLInputElement>({
    value: inputQq,
    onChange: e => setInputQq(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.qq })),
  })
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = normalizeTextInput(inputQq, { maxLength: TEXT_INPUT_LIMITS.qq })
    if (t) onLogin(t)
  }
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 pixel-bg-pattern relative overflow-hidden">
      {/* Floating decorations */}
      <div className="absolute top-[15%] left-[10%] opacity-30 pixel-carrot-float">
        <PixelCarrot size={40} />
      </div>
      <div className="absolute top-[20%] right-[15%] opacity-30 pixel-heart-float">
        <PixelHeart size={36} />
      </div>
      <div className="absolute bottom-[25%] left-[15%] opacity-25 pixel-star-float">
        <PixelStar size={32} />
      </div>
      <div className="absolute bottom-[20%] right-[10%] opacity-25 pixel-carrot-float" style={{ animationDelay: '2s' }}>
        <PixelCarrot size={28} />
      </div>
      <div className="absolute top-[45%] left-[5%] opacity-20 pixel-heart-float" style={{ animationDelay: '1s' }}>
        <PixelHeart size={24} />
      </div>
      <div className="absolute top-[50%] right-[5%] opacity-20 pixel-star-float" style={{ animationDelay: '1.5s' }}>
        <PixelStar size={28} />
      </div>

      {/* Main login card */}
        <div className="pixel-card p-8 flex flex-col items-center gap-5 relative z-10 max-w-sm w-full mx-4">
        {/* Pixel border top decoration */}
        <div className="pixel-border-top absolute top-0 left-0 right-0" />

        {/* Logo area */}
        <div className="flex flex-col items-center gap-3 mt-2">
          <h1 className="text-lg font-bold text-foreground pixel-font tracking-wider">
            兔扇报名助手
          </h1>
          <p className="text-xs text-muted-foreground pixel-font" style={{ fontSize: '8px' }}>
            RABBIT SIGNUP HELPER
          </p>
        </div>

        {/* Pixel divider */}
        <div className="pixel-divider w-full" />

        {/* Login form */}
        <form className="flex flex-col gap-3 w-full" onSubmit={handleSubmit}>
          <div className="relative">
            <input
              type="text"
              className="pixel-input w-full h-12 px-4 py-2 text-sm text-center font-mono tracking-wider"
              placeholder="输入QQ号开始冒险..."
              maxLength={TEXT_INPUT_LIMITS.qq}
              {...qqInputHandlers}
              onDrop={event => {
                if (hasNonTextTransfer(event.dataTransfer)) event.preventDefault()
              }}
              onPaste={event => {
                if (hasNonTextTransfer(event.clipboardData)) event.preventDefault()
              }}
              autoFocus
            />
          </div>
          <Button type="submit" className="pixel-btn w-full h-11 bg-primary text-primary-foreground font-bold tracking-wider hover:bg-primary/90">
            <PixelHeart size={16} className="mr-2" />
            开始冒险
            <PixelHeart size={16} className="ml-2" />
          </Button>
        </form>

        {/* Bottom decoration */}
        <div className="flex items-center gap-2 mt-1">
          <PixelStar size={12} className="opacity-50" />
          <span className="text-[10px] text-muted-foreground pixel-font" style={{ fontSize: '7px' }}>
            ENTER THE ADVENTURE
          </span>
          <PixelStar size={12} className="opacity-50" />
        </div>
      </div>
    </div>
  )
}

export default App
