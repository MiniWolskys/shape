import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { format, useT } from '../../i18n/i18n.ts'
import styles from './BlockGridPicker.module.css'

export const MAX_BLOCKS = 16

interface BlockGridPickerProps {
  width: number
  height: number
  disabled?: boolean
  /** Id of the text explaining why the picker is disabled. */
  describedBy?: string
  onPick(width: number, height: number): void
}

interface Cell {
  x: number
  y: number
}

const clampBlocks = (v: number) => Math.min(MAX_BLOCKS, Math.max(1, v))

const MOVES: Record<string, (c: Cell) => Cell> = {
  ArrowRight: (c) => ({ ...c, x: clampBlocks(c.x + 1) }),
  ArrowLeft: (c) => ({ ...c, x: clampBlocks(c.x - 1) }),
  ArrowDown: (c) => ({ ...c, y: clampBlocks(c.y + 1) }),
  ArrowUp: (c) => ({ ...c, y: clampBlocks(c.y - 1) }),
  Home: (c) => ({ ...c, x: 1 }),
  End: (c) => ({ ...c, x: MAX_BLOCKS }),
  PageUp: (c) => ({ ...c, y: 1 }),
  PageDown: (c) => ({ ...c, y: MAX_BLOCKS }),
}

function cellOf(target: EventTarget): Cell | null {
  if (!(target instanceof HTMLElement)) return null
  const x = Number(target.dataset.x)
  const y = Number(target.dataset.y)
  return x > 0 && y > 0 ? { x, y } : null
}

/**
 * A 16 × 16 grid of blocks: the top-left W × H cells are the painting. It is one tab stop;
 * arrow keys move the corner, Enter or Space picks it, and hovering previews a size.
 */
export function BlockGridPicker({
  width,
  height,
  disabled = false,
  describedBy,
  onPick,
}: BlockGridPickerProps) {
  const t = useT()
  const prefix = useId()
  const [hover, setHover] = useState<Cell | null>(null)
  const [cursor, setCursor] = useState<Cell | null>(null)

  const preview = disabled ? null : (hover ?? cursor)
  const shown = preview ?? { x: width, y: height }
  const cellId = (c: Cell) => `${prefix}-${c.x}-${c.y}`
  const label = (c: Cell) => format(t.editor.size.blocksValue, { width: c.x, height: c.y })

  function pick(c: Cell) {
    if (!disabled) onPick(c.x, c.y)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const current = cursor ?? { x: width, y: height }
    const move = MOVES[event.key]
    if (move) {
      event.preventDefault()
      setCursor(move(current))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pick(current)
    }
  }

  function onMouseOver(event: MouseEvent<HTMLDivElement>) {
    const c = cellOf(event.target)
    if (c && !disabled) setHover(c)
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const c = cellOf(event.target)
    if (c) pick(c)
  }

  const rows = Array.from({ length: MAX_BLOCKS }, (_, i) => i + 1)
  return (
    <div className={styles.picker}>
      <div
        role="grid"
        tabIndex={0}
        aria-label={t.editor.size.gridLabel}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={cursor && !disabled ? cellId(cursor) : undefined}
        className={styles.grid}
        onKeyDown={onKeyDown}
        onFocus={() => setCursor({ x: width, y: height })}
        onBlur={() => setCursor(null)}
        onMouseOver={onMouseOver}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        {rows.map((y) => (
          <div role="row" key={y} className={styles.row}>
            {rows.map((x) => {
              const c = { x, y }
              const inValue = x <= width && y <= height
              const inPreview = preview !== null && x <= preview.x && y <= preview.y
              return (
                <div
                  role="gridcell"
                  key={x}
                  id={cellId(c)}
                  aria-label={label(c)}
                  aria-selected={x === width && y === height}
                  data-x={x}
                  data-y={y}
                  data-value={inValue || undefined}
                  data-preview={inPreview || undefined}
                  data-cursor={(cursor && cursor.x === x && cursor.y === y) || undefined}
                  className={styles.cell}
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className={styles.readout} aria-live="polite">
        {label(shown)}
      </p>
    </div>
  )
}
