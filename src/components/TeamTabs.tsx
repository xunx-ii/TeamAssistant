import { useState, useRef, useEffect, memo } from 'react'
import { GripVertical, Plus } from 'lucide-react'
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
  onReorder: (ids: string[]) => void
}

export const TeamTabs = memo(function TeamTabs({ teams, activeId, isAdmin, onSwitch, onCreate, onDelete, onRename, onReorder }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    setDragIndex(null)
  }, [activeId])

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

  const handleDragStart = (index: number) => {
    if (!isAdmin) return
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      return
    }
    const newOrder = teams.map(t => t.id)
    const [moved] = newOrder.splice(dragIndex, 1)
    newOrder.splice(index, 0, moved)
    onReorder(newOrder)
    setDragIndex(null)
  }

  const handleTabClick = (id: string) => {
    setDragIndex(null)
    onSwitch(id)
  }

  if (teams.length === 0) return null

  return (
    <div className="w-full pixel-tabs-container">
      <div className="flex flex-wrap items-end gap-1">
        {teams.map((team, i) => (
          <div
            key={team.id}
            className={`relative flex items-center gap-1 px-4 py-2 text-sm cursor-pointer transition-colors select-none pixel-tab ${
              team.id === activeId
                ? 'active text-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            } ${dragIndex === i ? 'opacity-50' : ''}`}
            onClick={() => handleTabClick(team.id)}
            onDoubleClick={() => startEdit(team.id, team.name)}
            onDragOver={(e) => handleDragOver(e)}
            onDrop={() => handleDrop(i)}
          >
            {isAdmin && teams.length > 1 && (
              <button
                type="button"
                draggable={editingId === null}
                className="inline-flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label="拖动排序"
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onDragStart={(e) => {
                  e.stopPropagation()
                  handleDragStart(i)
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            {editingId === team.id ? (
              <Input
                ref={inputRef}
                className="h-6 w-[100px] text-sm px-1 py-0 pixel-input"
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
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded border-2 border-border bg-transparent inline-flex items-center justify-center mb-0.5" onClick={onCreate} title="创建团队">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
})
