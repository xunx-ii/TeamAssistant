import { useState } from 'react'
import { createTeamPublicationDraft, resolveTeamPublicationDraft, type TeamPublication } from '../teamPublication'
import { Button } from './ui/button'
import { TeamPublicationFields } from './TeamPublicationFields'

interface Props extends TeamPublication {
  onSave: (publication: TeamPublication) => Promise<boolean>
}

export function TeamPublicationEditor({ publicSignup, publicAtMs, onSave }: Props) {
  const [draft, setDraft] = useState(() => createTeamPublicationDraft({ publicSignup, publicAtMs }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const publication = resolveTeamPublicationDraft(draft)
    if (!publication) {
      setError('请选择有效的公开时间')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (!await onSave(publication)) setError('保存失败，请重试')
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="space-y-2" disabled={saving}>
      <TeamPublicationFields
        id="edit-team"
        {...draft}
        onNonPublicSignupChange={nonPublicSignup => setDraft(current => ({ ...current, nonPublicSignup }))}
        onPublicAtChange={publicAtInput => setDraft(current => ({ ...current, publicAtInput }))}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="xs" variant="outline" onClick={() => { void save() }}>保存公开设置</Button>
      </div>
    </fieldset>
  )
}
