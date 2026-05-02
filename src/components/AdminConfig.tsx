import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

interface Props {
  teamName: string
  note: string
  onRename: (name: string) => void
  onUpdateNote: (note: string) => void
  onQuickReserve: (type: 'T' | '治疗' | 'boss', count: number) => void
}

export function AdminConfig({ teamName, note, onRename, onUpdateNote, onQuickReserve }: Props) {
  const [open, setOpen] = useState(false)
  const [reserveT, setReserveT] = useState(0)
  const [reserveH, setReserveH] = useState(0)
  const [reserveB, setReserveB] = useState(0)
  const [editName, setEditName] = useState(teamName)

  return (
    <div className="mb-4">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        {open ? '收起设置' : '团队设置'}
      </Button>
      {open && (
        <div className="mt-3 space-y-4 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">团队名称</h3>
            <div className="flex gap-2">
              <Input
                className="h-8 text-sm"
                value={editName}
                onChange={e => setEditName(e.target.value)}
              />
              <Button size="xs" variant="outline" onClick={() => onRename(editName.trim() || teamName)}>
                保存
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
                  <Input
                    type="number" min={0} max={25}
                    className="w-14 h-8 text-center text-sm"
                    value={item.val} onChange={e => item.set(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                  <Button size="xs" variant="outline" onClick={() => { onQuickReserve(item.type, item.val); item.set(0) }}>
                    预留
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">团队备注</h3>
            <Textarea
              value={note}
              onChange={e => onUpdateNote(e.target.value)}
              placeholder="填写团队备注，显示在表格下方"
              rows={3}
            />
          </div>
        </div>
      )}
    </div>
  )
}
