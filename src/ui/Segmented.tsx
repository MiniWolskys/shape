import { useRef, type KeyboardEvent } from 'react'
import styles from './Segmented.module.css'

interface SegmentedProps<T extends string> {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange(v: T): void
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** A radio group drawn as a segmented control; arrow keys move the selection. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  function select(index: number) {
    const option = options[index]
    if (!option) return
    if (option.value !== value) onChange(option.value)
    buttons.current[index]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = options.length
    if (count === 0) return
    const current = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    )
    let next: number
    const step = STEP[event.key]
    if (step !== undefined) next = (current + step + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else return
    event.preventDefault()
    select(next)
  }

  const hasSelection = options.some((o) => o.value === value)
  return (
    <div role="radiogroup" aria-label={label} className={styles.group} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const checked = option.value === value
        const focusable = checked || (!hasSelection && index === 0)
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={focusable ? 0 : -1}
            className={styles.option}
            onClick={() => select(index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
