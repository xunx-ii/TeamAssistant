import * as React from 'react'
import { cn } from '../../lib/utils'
import { hasNonTextTransfer } from '../../textInput'
import { useImeSafeInputHandlers } from './imeInput'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, value, onDrop, onPaste, onChange, onInput, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const blockNonTextTransfer = type !== 'file'
    const imeHandlers = useImeSafeInputHandlers<HTMLInputElement>({
      value,
      onChange,
      onInput,
      onCompositionStart,
      onCompositionEnd,
    })

    return (
      <input
        type={type}
        value={imeHandlers.value}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        onChange={imeHandlers.onChange}
        onInput={imeHandlers.onInput}
        onCompositionStart={imeHandlers.onCompositionStart}
        onCompositionEnd={imeHandlers.onCompositionEnd}
        onDrop={(event) => {
          if (blockNonTextTransfer && hasNonTextTransfer(event.dataTransfer)) {
            event.preventDefault()
            return
          }
          onDrop?.(event)
        }}
        onPaste={(event) => {
          if (blockNonTextTransfer && hasNonTextTransfer(event.clipboardData)) {
            event.preventDefault()
            return
          }
          onPaste?.(event)
        }}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
