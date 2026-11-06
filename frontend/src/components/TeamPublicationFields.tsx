import { Input } from './ui/input'
import { Label } from './ui/label'

interface Props {
  id: string
  publicSignup: boolean
  publicAtInput: string
  onPublicSignupChange: (value: boolean) => void
  onPublicAtChange: (value: string) => void
}

export function TeamPublicationFields({ id, publicSignup, publicAtInput, onPublicSignupChange, onPublicAtChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={publicSignup} onChange={event => onPublicSignupChange(event.target.checked)} />
        公开报名
      </label>
      {publicSignup && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-public-at`}>公开时间</Label>
          <Input id={`${id}-public-at`} type="datetime-local" required value={publicAtInput} onChange={event => onPublicAtChange(event.target.value)} />
        </div>
      )}
    </div>
  )
}
