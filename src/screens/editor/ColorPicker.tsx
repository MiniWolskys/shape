import {
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { format, useT } from '../../i18n/i18n.ts'
import type { RGBA } from '../../imaging/raster.ts'
import {
  alphaToPercent,
  hsvToRgb,
  parseHex,
  percentToAlpha,
  rgbToHsv,
  sameColor,
  toHex,
  type HSV,
} from './color.ts'
import styles from './ColorPicker.module.css'

interface ColorPickerProps {
  color: RGBA
  onChange(color: RGBA): void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Arrow keys move the saturation/value marker by 1 %, or 10 % with Shift. */
const AREA_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

/**
 * Hue, saturation/value, opacity, hex and opacity %, all keyboard operable. The hue is kept
 * while the colour is grey or black, where the RGB value alone would lose it.
 */
export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const t = useT()
  const id = useId()
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color))
  const [known, setKnown] = useState<RGBA>(color)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [hexError, setHexError] = useState(false)
  const [opacityDraft, setOpacityDraft] = useState<string | null>(null)

  // A colour set from outside (preset, eyedropper, undo) moves the picker to it.
  if (!sameColor(known, color)) {
    const next = rgbToHsv(color)
    setKnown(color)
    setHsv(next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next)
  }

  const alpha = color[3]

  function emit(next: HSV, a = alpha) {
    const [r, g, b] = hsvToRgb(next)
    const rgba: RGBA = [r, g, b, a]
    setHsv(next)
    setKnown(rgba)
    onChange(rgba)
  }

  function commitHex() {
    if (hexDraft === null) return
    const rgb = parseHex(hexDraft)
    if (!rgb) {
      setHexError(true)
      return
    }
    setHexDraft(null)
    setHexError(false)
    const rgba: RGBA = [rgb[0], rgb[1], rgb[2], alpha]
    if (!sameColor(rgba, color)) onChange(rgba)
  }

  function commitOpacity() {
    if (opacityDraft === null) return
    const value = Number.parseFloat(opacityDraft)
    setOpacityDraft(null)
    if (Number.isFinite(value)) emitAlpha(percentToAlpha(value))
  }

  function emitAlpha(a: number) {
    if (a !== alpha) onChange([color[0], color[1], color[2], a])
  }

  function areaFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    emit({
      h: hsv.h,
      s: clamp01((event.clientX - rect.left) / rect.width),
      v: clamp01(1 - (event.clientY - rect.top) / rect.height),
    })
  }

  function onAreaKey(event: KeyboardEvent<HTMLDivElement>) {
    const move = AREA_KEYS[event.key]
    if (!move) return
    event.preventDefault()
    const step = event.shiftKey ? 0.1 : 0.01
    emit({ h: hsv.h, s: clamp01(hsv.s + move[0] * step), v: clamp01(hsv.v + move[1] * step) })
  }

  const [r, g, b] = color
  const vars = {
    '--hue': `hsl(${Math.round(hsv.h)} 100% 50%)`,
    '--solid': `rgb(${r} ${g} ${b})`,
    '--s': `${hsv.s * 100}%`,
    '--v': `${(1 - hsv.v) * 100}%`,
  } as CSSProperties
  const sPercent = Math.round(hsv.s * 100)
  const vPercent = Math.round(hsv.v * 100)

  return (
    <div className={styles.picker} style={vars}>
      <div
        className={styles.area}
        role="slider"
        tabIndex={0}
        aria-label={t.editor.picker.area}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={sPercent}
        aria-valuetext={format(t.editor.picker.areaValue, { s: sPercent, v: vPercent })}
        onKeyDown={onAreaKey}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          areaFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) areaFromPointer(event)
        }}
      >
        <span className={styles.marker} aria-hidden="true" />
      </div>
      <input
        type="range"
        className={`${styles.bar} ${styles.hue}`}
        min={0}
        max={359}
        step={1}
        value={Math.round(hsv.h) % 360}
        aria-label={t.editor.picker.hue}
        onChange={(event) => emit({ ...hsv, h: event.currentTarget.valueAsNumber })}
      />
      <input
        type="range"
        className={`${styles.bar} ${styles.alpha}`}
        min={0}
        max={100}
        step={1}
        value={alphaToPercent(alpha)}
        aria-label={t.editor.picker.opacity}
        aria-valuetext={format(t.editor.percent, { value: alphaToPercent(alpha) })}
        onChange={(event) => emitAlpha(percentToAlpha(event.currentTarget.valueAsNumber))}
      />
      <div className={styles.fields}>
        <span
          className={styles.current}
          role="img"
          aria-label={t.editor.picker.current}
          style={{ '--current': `rgb(${r} ${g} ${b} / ${alpha / 255})` } as CSSProperties}
        />
        <input
          type="text"
          className={styles.hex}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-label={t.editor.picker.hex}
          aria-invalid={hexError}
          aria-describedby={hexError ? `${id}-hex-error` : undefined}
          value={hexDraft ?? toHex(color)}
          onChange={(event) => setHexDraft(event.currentTarget.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitHex()
            else if (event.key === 'Escape') {
              setHexDraft(null)
              setHexError(false)
            }
          }}
        />
        <label className={styles.opacity}>
          <span>{t.editor.picker.opacity}</span>
          <input
            type="number"
            className={styles.number}
            min={0}
            max={100}
            step={1}
            value={opacityDraft ?? String(alphaToPercent(alpha))}
            onChange={(event) => setOpacityDraft(event.currentTarget.value)}
            onBlur={commitOpacity}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitOpacity()
            }}
          />
          <span aria-hidden="true">%</span>
        </label>
      </div>
      {hexError && (
        <p id={`${id}-hex-error`} className={styles.error} role="alert">
          {t.editor.picker.hexInvalid}
        </p>
      )}
    </div>
  )
}
