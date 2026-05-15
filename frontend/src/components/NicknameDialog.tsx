import { useState } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { useImeSafeInputHandlers } from './ui/imeInput'
import { hasNonTextTransfer, normalizeTextInput, sanitizeTextInput, TEXT_INPUT_LIMITS } from '../textInput'

interface Props {
  open: boolean
  qq: string
  nickname: string
  required?: boolean
  errorMessage?: string
  onConfirm: (nickname: string) => void
  onClose: () => void
  onLogout?: () => void
}

export function NicknameDialog({ open, qq, nickname, required = false, errorMessage = '', onConfirm, onClose, onLogout }: Props) {
  const [value, setValue] = useState(() => nickname)
  const [localError, setLocalError] = useState('')
  const error = localError || errorMessage
  const inputHandlers = useImeSafeInputHandlers<HTMLInputElement>({
    value,
    onChange: event => {
      setValue(sanitizeTextInput(event.target.value, { maxLength: TEXT_INPUT_LIMITS.nickname }))
      setLocalError('')
    },
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = normalizeTextInput(value, { maxLength: TEXT_INPUT_LIMITS.nickname })
    setValue(normalized)
    if (!normalized) {
      setLocalError('请输入昵称')
      return
    }
    onConfirm(normalized)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return
    if (!required) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        key={`${qq}-${nickname}-${open ? 'open' : 'closed'}`}
        className="max-w-sm"
        hideClose={required}
        onPointerDownOutside={event => {
          if (required) event.preventDefault()
        }}
        onEscapeKeyDown={event => {
          if (required) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{required ? '设置昵称' : '修改昵称'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label>QQ</Label>
            <Input value={qq} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>昵称</Label>
            <Input
              maxLength={TEXT_INPUT_LIMITS.nickname}
              autoFocus
              {...inputHandlers}
              onDrop={event => {
                if (hasNonTextTransfer(event.dataTransfer)) event.preventDefault()
              }}
              onPaste={event => {
                if (hasNonTextTransfer(event.clipboardData)) event.preventDefault()
              }}
            />
          </div>
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            {required && onLogout && (
              <Button type="button" variant="outline" className="flex-1" onClick={onLogout}>
                退出登录
              </Button>
            )}
            {!required && (
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                取消
              </Button>
            )}
            <Button type="submit" className="flex-1">
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
