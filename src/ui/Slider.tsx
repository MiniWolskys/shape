import styles from './Slider.module.css'

interface SliderProps {
  id: string
  label: string
  min: number
  max: number
  step?: number
  value: number
  unit?: string
  disabled?: boolean
  onChange(v: number): void
}

export function Slider({
  id,
  label,
  min,
  max,
  step = 1,
  value,
  unit,
  disabled,
  onChange,
}: SliderProps) {
  const shown = unit ? `${value} ${unit}` : String(value)
  return (
    <div className={styles.field}>
      <div className={styles.row}>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className={styles.value}>
          {shown}
        </output>
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
      />
    </div>
  )
}
