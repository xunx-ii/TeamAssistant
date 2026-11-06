import { useState } from 'react'
import type { TeamPublication } from '../teamPublication'
import { formatShanghaiDateTimeLocalInput, parseShanghaiDateTimeLocalInput } from '../time'
import { Button } from './ui/button'
import { TeamPublicationFields } from './TeamPublicationFields'

interface Props extends TeamPublication {
  onSave: (publication: TeamPublication) => Promise<boolean>
}

export function TeamPublicationEditor({ publicSignup, publicAtMs, onSave }: Props) {
  const [isPublic, setIsPublic] = useState(publicSignup)
  const [input, setInput] = useState(() => formatShanghaiDateTimeLocalInput(publicAtMs || Date.now()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const timestamp = isPublic ? parseShanghaiDateTimeLocalInput(input) : 0
    if (timestamp === null || timestamp < 0) {
      setError('请选择有效的公开时间')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (!await onSave({ publicSignup: isPublic, publicAtMs: timestamp })) setError('保存失败，请重试')
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset className="space-y-2" disabled={saving}>
      <TeamPublicationFields id="edit-team" publicSignup={isPublic} publicAtInput={input} onPublicSignupChange={setIsPublic} onPublicAtChange={setInput} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="xs" variant="outline" onClick={() => { void save() }}>保存公开设置</Button>
      </div>
    </fieldset>
  )
}
