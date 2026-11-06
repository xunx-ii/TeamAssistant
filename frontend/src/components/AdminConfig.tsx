import { useEffect, useState, memo } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { TeamWeekSelector } from './TeamWeekSelector'
import { TeamPublicationEditor } from './TeamPublicationEditor'
import type { TeamPublication } from '../teamPublication'
import { normalizeTextInput, sanitizeIntegerInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'
import { formatWeekRange } from '../week'

interface Props {
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
  onUpdateNote: (note: string) => void
  onQuickReserve: (type: 'T' | '治疗' | 'boss', count: number) => void
  onToggleLock: () => void
  onUpdateSignupRules: (rules: { onlyTnSignup: boolean; uniqueQqSignup: boolean }) => void
  onViewLogs: () => void
  onCopyTeam: () => void
  onArchive: () => void
  onOpenSubsidyConfig: () => void
}

export const AdminConfig = memo(function AdminConfig({ teamName, weekStart, note, serverMode, locked, onlyTnSignup, uniqueQqSignup, publication, onSavePublication, onRename, onSaveWeekStart, onUpdateNote, onQuickReserve, onToggleLock, onUpdateSignupRules, onViewLogs, onCopyTeam, onArchive, onOpenSubsidyConfig }: Props) {
  const [open, setOpen] = useState(false)
  const [reserveT, setReserveT] = useState(0)
  const [reserveH, setReserveH] = useState(0)
  const [reserveB, setReserveB] = useState(0)
  const [editName, setEditName] = useState(teamName)
  const [weekDraft, setWeekDraft] = useState(() => ({ source: weekStart, value: weekStart }))
  const normalizeReserveCount = (value: string) => Math.min(25, Math.max(0, parseInt(sanitizeIntegerInput(value, 2)) || 0))
  const editWeekStart = weekDraft.source === weekStart ? weekDraft.value : weekStart
  const updateEditWeekStart = (value: string) => {
    setWeekDraft({ source: weekStart, value })
  }

  useEffect(() => {
    setEditName(teamName)
  }, [teamName])

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {open ? '收起设置' : '团队设置'}
        </Button>
        <Button
          variant={locked ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleLock}
        >
          {locked ? '已锁定' : '锁定表格'}
        </Button>
        <Button variant="outline" size="sm" onClick={onViewLogs}>
          查看日志
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSubsidyConfig}>
          补贴设置
        </Button>
        <Button variant="outline" size="sm" onClick={onCopyTeam}>
          复制团队
        </Button>
      </div>
      {open && (
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
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">团队备注</h3>
            <Textarea value={note} onChange={e => onUpdateNote(sanitizeTextInput(e.target.value, { maxLength: TEXT_INPUT_LIMITS.note, multiline: true }))}
              maxLength={TEXT_INPUT_LIMITS.note}
              placeholder="填写团队备注，显示在表格下方" rows={3} />
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
