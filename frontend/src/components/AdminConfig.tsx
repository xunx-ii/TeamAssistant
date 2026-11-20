import { useEffect, useRef, useState, memo } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { TeamWeekSelector } from './TeamWeekSelector'
import { TeamPublicationEditor } from './TeamPublicationEditor'
import type { TeamPublication } from '../teamPublication'
import type { TeamTemplate } from '../types'
import type { TeamTemplateDeleteResult } from '../teamTemplates'
import { clearTeamNoteDraft, loadTeamNoteDraft, saveTeamNoteDraft } from '../teamNoteDraft'
import { normalizeTextInput, sanitizeIntegerInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import { formatWeekRange } from '../week'

interface Props {
  teamId: string
  actorQq: string
  isAdmin: boolean
  teamName: string
  weekStart: string
  note: string
  serverMode: boolean
  locked: boolean
  onlyTnSignup: boolean
  uniqueQqSignup: boolean
  publication: TeamPublication
  onSavePublication: (publication: TeamPublication) => Promise<boolean>
  onRename: (name: string) => void
  onSaveWeekStart: (weekStart: string) => void
  onUpdateNote: (note: string) => Promise<boolean>
  onQuickReserve: (type: 'T' | '治疗' | 'boss', count: number) => void
  onToggleLock: () => void
  onUpdateSignupRules: (rules: { onlyTnSignup: boolean; uniqueQqSignup: boolean }) => void
  onViewLogs: () => void
  onCopyTeam: () => void
  onArchive: () => void
  onOpenSubsidyConfig: () => void
  teamTemplates: TeamTemplate[]
  onSaveTeamTemplate: (name: string, note: string) => Promise<boolean>
  onDeleteTeamTemplate: (templateId: string) => Promise<TeamTemplateDeleteResult>
}

export const AdminConfig = memo(function AdminConfig({ teamId, actorQq, isAdmin, teamName, weekStart, note, serverMode, locked, onlyTnSignup, uniqueQqSignup, publication, onSavePublication, onRename, onSaveWeekStart, onUpdateNote, onQuickReserve, onToggleLock, onUpdateSignupRules, onViewLogs, onCopyTeam, onArchive, onOpenSubsidyConfig, teamTemplates, onSaveTeamTemplate, onDeleteTeamTemplate }: Props) {
  const [open, setOpen] = useState(false)
  const [reserveT, setReserveT] = useState(0)
  const [reserveH, setReserveH] = useState(0)
  const [reserveB, setReserveB] = useState(0)
  const [editName, setEditName] = useState(teamName)
  const [templateName, setTemplateName] = useState(teamName)
  const [templateError, setTemplateError] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  // Keep note editing local so slow responses never replace newer keystrokes.
  const [noteDraft, setNoteDraft] = useState(() => {
    const stored = loadTeamNoteDraft(teamId, actorQq)
    return stored === null
      ? note
      : sanitizeTextInput(stored, { maxLength: TEXT_INPUT_LIMITS.note, multiline: true })
  })
  const [noteSaveStatus, setNoteSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const noteDraftRef = useRef(noteDraft)
  const savedNoteRef = useRef(note)
  const noteDirtyRef = useRef(noteDraft !== note)
  const noteSaveInFlightRef = useRef(false)
  const noteMountedRef = useRef(true)
  const onUpdateNoteRef = useRef(onUpdateNote)
  const [weekDraft, setWeekDraft] = useState(() => ({ source: weekStart, value: weekStart }))
  const normalizeReserveCount = (value: string) => Math.min(25, Math.max(0, parseInt(sanitizeIntegerInput(value, 2)) || 0))
  const editWeekStart = weekDraft.source === weekStart ? weekDraft.value : weekStart
  const updateEditWeekStart = (value: string) => {
    setWeekDraft({ source: weekStart, value })
  }

  useEffect(() => {
    setEditName(teamName)
    setTemplateName(teamName)
  }, [teamName])

  onUpdateNoteRef.current = onUpdateNote

  useEffect(() => {
    if (note === noteDraftRef.current) {
      savedNoteRef.current = note
      noteDirtyRef.current = false
      clearTeamNoteDraft(teamId, actorQq, note)
      if (!noteSaveInFlightRef.current) setNoteSaveStatus('idle')
      return
    }
    if (noteDirtyRef.current || noteSaveInFlightRef.current) return
    noteDraftRef.current = note
    savedNoteRef.current = note
    setNoteDraft(note)
    clearTeamNoteDraft(teamId, actorQq)
    setNoteSaveStatus('idle')
  }, [actorQq, note, teamId])

  useEffect(() => {
    noteMountedRef.current = true
    return () => {
      noteMountedRef.current = false
    }
  }, [])

  const persistNote = async (value: string): Promise<boolean> => {
    if (value === savedNoteRef.current) {
      noteDirtyRef.current = false
      if (noteMountedRef.current) setNoteSaveStatus('idle')
      return true
    }
    if (noteSaveInFlightRef.current) return false

    noteSaveInFlightRef.current = true
    if (noteMountedRef.current) setNoteSaveStatus('saving')
    let saved = false
    try {
      // Only one note request may run at a time; newer text is saved afterwards.
      saved = await onUpdateNoteRef.current(value)
      if (!saved) {
        if (noteMountedRef.current) setNoteSaveStatus('error')
        return false
      }
      savedNoteRef.current = value
      if (noteDraftRef.current === value) {
        noteDirtyRef.current = false
        clearTeamNoteDraft(teamId, actorQq, value)
        if (noteMountedRef.current) setNoteSaveStatus('idle')
      }
      return true
    } finally {
      noteSaveInFlightRef.current = false
      if (saved && noteDraftRef.current !== value) {
        void persistNote(noteDraftRef.current)
      }
    }
  }

  const handleNoteChange = (value: string) => {
    const next = sanitizeTextInput(value, { maxLength: TEXT_INPUT_LIMITS.note, multiline: true })
    noteDraftRef.current = next
    setNoteDraft(next)
    noteDirtyRef.current = next !== savedNoteRef.current
    if (noteDirtyRef.current) saveTeamNoteDraft(teamId, actorQq, next)
    else clearTeamNoteDraft(teamId, actorQq, next)
    setNoteSaveStatus(noteSaveInFlightRef.current ? 'saving' : 'idle')
  }

  const flushNote = () => {
    if (!noteDirtyRef.current) return
    void persistNote(noteDraftRef.current)
  }

  const handleSaveTemplate = async () => {
    if (savingTemplate) return
    const name = normalizeTextInput(templateName, { maxLength: TEXT_INPUT_LIMITS.teamTemplateName })
    if (!name) {
      setTemplateError('请输入模板名称')
      return
    }
    if (teamTemplates.some(template => template.name.trim().toLowerCase() === name.toLowerCase())) {
      setTemplateError('模板名称已存在')
      return
    }
    setSavingTemplate(true)
    setTemplateError('')
    try {
      const saved = await onSaveTeamTemplate(name, noteDraftRef.current)
      if (!saved) {
        setTemplateError('保存失败，请稍后重试')
        return
      }
      setTemplateName('')
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async (templateId: string) => {
    setTemplateError('')
    const result = await onDeleteTeamTemplate(templateId)
    if (result === 'failed') setTemplateError('删除失败，请稍后重试')
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? '收起设置' : '团队设置'}
          </Button>
        )}
        {isAdmin && (
          <Button
            variant={locked ? 'default' : 'outline'}
            size="sm"
            onClick={onToggleLock}
          >
            {locked ? '已锁定' : '锁定表格'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onViewLogs}>
          查看团队日志
        </Button>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={onOpenSubsidyConfig}>
            补贴设置
          </Button>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={onCopyTeam}>
            复制团队
          </Button>
        )}
      </div>
      {isAdmin && open && (
        <div className="mt-3 space-y-4 rounded-lg border border-border p-4">
          <TeamPublicationEditor key={`${publication.publicSignup}-${publication.publicAtMs}`} {...publication} onSave={onSavePublication} />
          {serverMode && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">数据同步</h3>
              <span className="text-xs text-blue-400">数据已连接服务器，多设备共享中</span>
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">团队名称</h3>
            <div className="flex gap-2">
              <Input
                className="h-8 text-sm"
                value={editName}
                maxLength={TEXT_INPUT_LIMITS.teamName}
                onChange={e => setEditName(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.teamName }))}
              />
              <Button size="xs" variant="outline" onClick={() => onRename(normalizeTextInput(editName, { maxLength: TEXT_INPUT_LIMITS.teamName }) || teamName)}>保存</Button>
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">开团模板</h3>
            <div className="flex gap-2">
              <Input
                className="h-8 text-sm"
                value={templateName}
                maxLength={TEXT_INPUT_LIMITS.teamTemplateName}
                placeholder="模板名称"
                onChange={e => {
                  setTemplateName(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.teamTemplateName }))
                  setTemplateError('')
                }}
              />
              <Button size="xs" variant="outline" disabled={savingTemplate} onClick={() => { void handleSaveTemplate() }}>
                保存模板
              </Button>
            </div>
            {teamTemplates.length > 0 && (
              <div className="space-y-1">
                {teamTemplates.map(template => (
                  <div key={template.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                    <span className="min-w-0 truncate text-xs text-foreground">{template.name}</span>
                    <Button size="xs" variant="ghost" onClick={() => { void handleDeleteTemplate(template.id) }}>
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {templateError && <p className="text-xs text-destructive">{templateError}</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">团队时间</h3>
            <p className="text-xs text-muted-foreground" aria-label="团队实际时间">
              实际时间：{formatWeekRange(weekStart)}
            </p>
            <TeamWeekSelector
              value={editWeekStart}
              label="调整时间"
              onChange={updateEditWeekStart}
            />
            <div className="flex justify-end">
              <Button
                size="xs"
                variant="outline"
                disabled={editWeekStart === weekStart}
                onClick={() => onSaveWeekStart(editWeekStart)}
              >
                保存时间
              </Button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">快速预留</h3>
            <div className="flex flex-wrap gap-4">
              {([
                { label: 'T', val: reserveT, set: setReserveT, type: 'T' as const },
                { label: '奶', val: reserveH, set: setReserveH, type: '治疗' as const },
                { label: '老板', val: reserveB, set: setReserveB, type: 'boss' as const },
              ]).map(item => (
                <div key={item.type} className="flex items-center gap-2">
                  <span className="text-sm font-medium min-w-[24px]">{item.label}</span>
                  <Input type="number" min={0} max={25} className="w-14 h-8 text-center text-sm"
                    value={item.val} onChange={e => item.set(normalizeReserveCount(e.target.value))} />
                  <Button size="xs" variant="outline" onClick={() => { onQuickReserve(item.type, item.val); item.set(0) }}>预留</Button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">报名规则</h3>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={onlyTnSignup}
                  onChange={e => onUpdateSignupRules({ onlyTnSignup: e.target.checked, uniqueQqSignup })}
                />
                仅限TN报名
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={uniqueQqSignup}
                  onChange={e => onUpdateSignupRules({ onlyTnSignup, uniqueQqSignup: e.target.checked })}
                />
                每人仅报名一次
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">团队备注</h3>
              <Button
                size="xs"
                variant="outline"
                disabled={!noteDirtyRef.current || noteSaveStatus === 'saving'}
                onClick={flushNote}
              >
                {noteSaveStatus === 'saving' ? '保存中' : '保存备注'}
              </Button>
            </div>
            <Textarea
              value={noteDraft}
              onChange={e => handleNoteChange(e.target.value)}
              onBlur={flushNote}
              maxLength={TEXT_INPUT_LIMITS.note}
              placeholder="填写团队备注，显示在表格下方"
              rows={3}
            />
            {noteSaveStatus === 'error' && (
              <p className="text-xs text-destructive">保存失败，文字已保留，请重试</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">表格归档</h3>
            <Button size="sm" variant="outline" onClick={onArchive}>归档当前表格</Button>
          </div>
        </div>
      )}
    </div>
  )
})
