import { useState, useRef, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface Props {
  teams: { id: string; name: string }[]
  activeId: string
  isAdmin: boolean
  onSwitch: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export function TeamTabs({ teams, activeId, isAdmin, onSwitch, onCreate, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startEdit = (id: string, name: string) => {
    if (!isAdmin) return
    setEditingId(id)
    setEditValue(name)
  }

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditingId(null)
  }

  if (teams.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 border-b border-border">
        {teams.map(team => (
          <div
            key={team.id}
            className={`relative flex items-center gap-1 rounded-t-lg px-4 py-2 text-sm cursor-pointer transition-colors select-none border border-transparent border-b-0 mb-[-1px] ${
              team.id === activeId
                ? 'bg-background border-border text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
            onClick={() => onSwitch(team.id)}
            onDoubleClick={() => startEdit(team.id, team.name)}
          >
            {editingId === team.id ? (
              <Input
                ref={inputRef}
                className="h-6 w-[100px] text-sm px-1 py-0"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="max-w-[120px] truncate">{team.name}</span>
            )}
            {isAdmin && teams.length > 1 && (
              <button
                className="ml-1 rounded-full p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={e => { e.stopPropagation(); onDelete(team.id) }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {isAdmin && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onCreate} title="创建团队">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
