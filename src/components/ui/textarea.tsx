import * as React from 'react'
import { cn } from '../../lib/utils'
import { hasNonTextTransfer } from '../../textInput'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, onDrop, onPaste, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        onDrop={(event) => {
          if (hasNonTextTransfer(event.dataTransfer)) {
            event.preventDefault()
            return
          }
          onDrop?.(event)
        }}
        onPaste={(event) => {
          if (hasNonTextTransfer(event.clipboardData)) {
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
Textarea.displayName = 'Textarea'

export { Textarea }
