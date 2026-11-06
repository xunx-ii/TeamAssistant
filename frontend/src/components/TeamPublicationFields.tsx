import { Input } from './ui/input'
import { Label } from './ui/label'

interface Props {
  id: string
  nonPublicSignup: boolean
  publicAtInput: string
  onNonPublicSignupChange: (value: boolean) => void
  onPublicAtChange: (value: string) => void
}

export function TeamPublicationFields({ id, nonPublicSignup, publicAtInput, onNonPublicSignupChange, onPublicAtChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={nonPublicSignup} onChange={event => onNonPublicSignupChange(event.target.checked)} />
        不公开报名
      </label>
      {nonPublicSignup && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-public-at`}>公开时间</Label>
          <Input id={`${id}-public-at`} type="datetime-local" min="1970-01-01T08:00" max="9999-12-31T23:59" value={publicAtInput} onChange={event => onPublicAtChange(event.target.value)} />
        </div>
      )}
    </div>
  )
}
