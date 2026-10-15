import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { format, useT } from '../../i18n/i18n.ts'
import { centeredCrop, fitWithin, flip, rotate } from '../../imaging/transform.ts'
import { NO_CROP, turnedSize, useEditor } from '../../state/editor.ts'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import styles from './CropBox.module.css'

type Rect = { x: number; y: number; width: number; height: number }

/** Largest size the picture is drawn at in the inspector. */
const BOX = { width: 290, height: 240 }
/** Smallest crop, as a share of the largest one. */
const MIN_SHARE = 0.05
const ZOOM_FACTOR = 0.9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Phones and tablets: the hint talks about pinching instead of the wheel and keys. */
const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function writeCrop(rect: Rect, merge?: string) {
  useEditor
    .getState()
    .change(
      (p) => (sameRect(p.recipe.crop, rect) ? p : { ...p, recipe: { ...p.recipe, crop: rect } }),
      merge ? { merge } : undefined,
    )
}

/**
 * The rotated and flipped picture with a rectangle locked to the painting's ratio. Drag it to
 * move, pinch or use + / − to resize, arrow keys to nudge; the wheel resizes once the rectangle
 * has focus (a click), so scrolling the inspector past it never changes the crop (I23). Writes
 * recipe.crop in whole source pixels, always inside the picture.
 */
export function CropBox() {
  const t = useT()
  const source = useEditor((s) => s.source)
  const painting = useEditor((s) => s.painting)
  const container = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; start: Rect } | null>(null)
  /** Pointers down on the rectangle; two of them pinch. */
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; start: Rect } | null>(null)
  const hintId = useId()

  const rotation = painting?.recipe.rotation ?? 0
  const flipX = painting?.recipe.flipX ?? false
  const flipY = painting?.recipe.flipY ?? false
  // The picture is shrunk before turning it, so this stays cheap for large pictures.
  const preview = useMemo(
    () =>
      source &&
      flip(rotate(fitWithin(source, Math.max(BOX.width, BOX.height) * 2), rotation), flipX, flipY),
    [source, rotation, flipX, flipY],
  )

  const turned = source && turnedSize(source, rotation)
  const ratioW = painting?.width ?? 1
  const ratioH = painting?.height ?? 1
  const largest = turned && centeredCrop(turned.width, turned.height, ratioW, ratioH)
  const stored = painting?.recipe.crop ?? NO_CROP
  const fits =
    turned !== null &&
    stored.width > 0 &&
    stored.height > 0 &&
    stored.x >= 0 &&
    stored.y >= 0 &&
    stored.x + stored.width <= turned.width &&
    stored.y + stored.height <= turned.height
  const rect: Rect | null = fits ? stored : largest

  const scale = turned ? Math.min(BOX.width / turned.width, BOX.height / turned.height) : 1

  /** Same centre, `factor` times the size, kept inside the picture and the ratio. */
  function resized(current: Rect, factor: number): Rect | null {
    if (!turned || !largest) return null
    const minWidth = Math.max(1, Math.ceil(ratioW / ratioH), Math.round(largest.width * MIN_SHARE))
    const width = clamp(Math.round(current.width * factor), minWidth, largest.width)
    const height = clamp(Math.round((width * ratioH) / ratioW), 1, largest.height)
    const cx = current.x + current.width / 2
    const cy = current.y + current.height / 2
    return {
      x: clamp(Math.round(cx - width / 2), 0, turned.width - width),
      y: clamp(Math.round(cy - height / 2), 0, turned.height - height),
      width,
      height,
    }
  }

  function moved(current: Rect, dx: number, dy: number): Rect | null {
    if (!turned) return null
    return {
      ...current,
      x: clamp(Math.round(current.x + dx), 0, turned.width - current.width),
      y: clamp(Math.round(current.y + dy), 0, turned.height - current.height),
    }
  }

  function zoom(factor: number, merge?: string) {
    const next = rect && resized(rect, factor)
    if (next) writeCrop(next, merge)
  }

  // Wheel resizing needs a non-passive listener to keep the inspector from scrolling.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  })
  useEffect(() => {
    const el = container.current
    if (!el) return
    function onWheel(event: WheelEvent) {
      if (event.deltaY === 0 || !el?.contains(document.activeElement)) return
      event.preventDefault()
      zoomRef.current(event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR, 'crop.zoom')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [preview])

  if (!preview || !rect || !turned) {
    return <p className={styles.empty}>{t.editor.size.cropNeedsPicture}</p>
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !rect) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const [a, b] = [...pointers.current.values()]
    if (a && b) {
      // A second finger: pinch from here, no more dragging.
      drag.current = null
      pinch.current = { distance: distance(a, b), start: rect }
    } else {
      drag.current = { px: event.clientX, py: event.clientY, start: rect }
    }
  }

  /** One drag or pinch is one undo step. */
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    drag.current = null
    useEditor.getState().endGesture()
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    const p = pinch.current
    const [a, b] = [...pointers.current.values()]
    if (p && a && b) {
      const now = distance(a, b)
      const next = now > 0 ? resized(p.start, p.distance / now) : null
      if (next && rect && !sameRect(next, rect)) writeCrop(next, 'crop.zoom')
      return
    }
    const d = drag.current
    if (!d) return
    const next = moved(d.start, (event.clientX - d.px) / scale, (event.clientY - d.py) / scale)
    if (next && (next.x !== rect?.x || next.y !== rect.y)) writeCrop(next, 'crop.move')
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!rect) return
    // One step is one screen pixel, at least one picture pixel; Shift moves ten times as far.
    const step = Math.max(1, Math.round(1 / scale)) * (event.shiftKey ? 10 : 1)
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = deltas[event.key]
    let next: Rect | null = null
    if (delta) next = moved(rect, delta[0], delta[1])
    else if (event.key === '+' || event.key === '=') next = resized(rect, ZOOM_FACTOR)
    else if (event.key === '-' || event.key === '_') next = resized(rect, 1 / ZOOM_FACTOR)
    else return
    event.preventDefault()
    if (next) writeCrop(next, 'crop.keys')
  }

  return (
    <div className={styles.crop}>
      <div
        ref={container}
        className={styles.picture}
        style={{ width: turned.width * scale, height: turned.height * scale }}
      >
        <PaintingCanvas
          raster={preview}
          scale={(turned.width * scale) / preview.width}
          label={t.editor.image.heading}
        />
        <div
          role="group"
          tabIndex={0}
          aria-label={format(t.editor.size.cropArea, rect)}
          aria-describedby={hintId}
          className={styles.rect}
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: rect.width * scale,
            height: rect.height * scale,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          aria-label={t.editor.zoomOut}
          title={t.editor.zoomOut}
          onClick={() => zoom(1 / ZOOM_FACTOR)}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          className={styles.button}
          aria-label={t.editor.zoomIn}
          title={t.editor.zoomIn}
          onClick={() => zoom(ZOOM_FACTOR)}
        >
          <Icon name="plus" />
        </button>
        <button type="button" className={styles.text} onClick={() => writeCrop({ ...NO_CROP })}>
          {t.editor.size.cropCenter}
        </button>
      </div>
      <p id={hintId} className={styles.hint}>
        {coarsePointer() ? t.editor.size.cropHintTouch : t.editor.size.cropHint}
      </p>
    </div>
  )
}
