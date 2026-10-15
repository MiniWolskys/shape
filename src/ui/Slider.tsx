import { useState } from 'react'
import styles from './Slider.module.css'

interface SliderProps {
  id: string
  label: string
  min: number
  max: number
  step?: number
  value: number
  /** A double-click on the label or the slider puts this value back (M4). */
  defaultValue?: number
  unit?: string
  disabled?: boolean
  onChange(v: number): void
}

/**
 * A range slider with its value in an editable number field (M4): typing sets an exact value,
 * kept within the range; an empty or unreadable field goes back to the value when it loses focus.
 */
export function Slider({
  id,
  label,
  min,
  max,
  step = 1,
  value,
  defaultValue,
  unit,
  disabled,
  onChange,
}: SliderProps) {
  /** What is typed in the number field, while it differs from the value. */
  const [draft, setDraft] = useState<string | null>(null)
  const shown = unit ? `${value} ${unit}` : String(value)

  const within = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const reset =
    defaultValue === undefined || disabled
      ? undefined
      : () => {
          if (value !== defaultValue) onChange(defaultValue)
        }

  /** Takes the typed value (kept within the range) and shows the value again. */
  function commit() {
    if (draft !== null && draft.trim() !== '') {
      const typed = Number(draft)
      if (Number.isFinite(typed) && within(typed) !== value) onChange(within(typed))
    }
    setDraft(null)
  }

  return (
    <div className={styles.field}>
      <div className={styles.row}>
        <label htmlFor={id} onDoubleClick={reset}>
          {label}
        </label>
        <span className={styles.value}>
          <input
            className={styles.number}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            disabled={disabled}
            aria-label={unit ? `${label} (${unit})` : label}
            onChange={(event) => {
              const text = event.currentTarget.value
              setDraft(text)
              const typed = Number(text)
              // Values in range take effect at once; others wait for Enter or leaving the field.
              if (text.trim() !== '' && Number.isFinite(typed) && typed >= min && typed <= max) {
                if (within(typed) !== value) onChange(within(typed))
              }
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              else if (event.key === 'Escape' && draft !== null) {
                // Escape puts the value back here, without leaving the editor's selection.
                event.stopPropagation()
                setDraft(null)
              }
            }}
          />
          {unit && <span aria-hidden="true">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        className={styles.input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        onDoubleClick={reset}
      />
    </div>
  )
}
