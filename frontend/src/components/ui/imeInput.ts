import { useRef, useState, type ChangeEvent, type ChangeEventHandler, type CompositionEventHandler, type FormEvent, type FormEventHandler } from 'react'
import { isTextInputComposing } from '../../textInput'

type TextControlElement = HTMLInputElement | HTMLTextAreaElement
type TextControlValue = string | number | readonly string[] | undefined

interface ImeSafeInputHandlers<T extends TextControlElement> {
  value?: TextControlValue
  onChange?: ChangeEventHandler<T>
  onInput?: FormEventHandler<T>
  onCompositionStart?: CompositionEventHandler<T>
  onCompositionEnd?: CompositionEventHandler<T>
}

export function useImeSafeInputHandlers<T extends TextControlElement>({
  value,
  onChange,
  onInput,
  onCompositionStart,
  onCompositionEnd,
}: ImeSafeInputHandlers<T>) {
  const composingRef = useRef(false)
  const committedValueRef = useRef<{ value: string, skipChange: boolean, skipInput: boolean } | null>(null)
  const [compositionValue, setCompositionValue] = useState<string>()

  const updateCompositionValue = (event: FormEvent<T>) => {
    if (value !== undefined) {
      setCompositionValue(event.currentTarget.value)
    }
  }

  const handleCompositionStart: CompositionEventHandler<T> = (event) => {
    composingRef.current = true
    updateCompositionValue(event)
    onCompositionStart?.(event)
  }

  const handleCompositionEnd: CompositionEventHandler<T> = (event) => {
    composingRef.current = false
    setCompositionValue(undefined)
    onCompositionEnd?.(event)
    if (event.defaultPrevented) return

    committedValueRef.current = {
      value: event.currentTarget.value,
      skipChange: true,
      skipInput: true,
    }
    onChange?.(event as unknown as ChangeEvent<T>)
    onInput?.(event as unknown as FormEvent<T>)
  }

  const handleChange: ChangeEventHandler<T> = (event) => {
    if (isTextInputComposing(event, composingRef.current)) {
      updateCompositionValue(event)
      return
    }
    if (committedValueRef.current?.skipChange && committedValueRef.current.value === event.currentTarget.value) {
      committedValueRef.current.skipChange = false
      return
    }
    if (committedValueRef.current && committedValueRef.current.value !== event.currentTarget.value) {
      committedValueRef.current = null
    }
    onChange?.(event)
  }

  const handleInput: FormEventHandler<T> = (event) => {
    if (isTextInputComposing(event, composingRef.current)) {
      updateCompositionValue(event)
      return
    }
    if (committedValueRef.current?.skipInput && committedValueRef.current.value === event.currentTarget.value) {
      committedValueRef.current.skipInput = false
      return
    }
    if (committedValueRef.current && committedValueRef.current.value !== event.currentTarget.value) {
      committedValueRef.current = null
    }
    onInput?.(event)
  }

  return {
    value: compositionValue ?? value,
    onChange: handleChange,
    onInput: handleInput,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
  }
}
