import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { format, useT } from '../../i18n/i18n.ts'
import type { Raster } from '../../imaging/raster.ts'
import { renderWallPreview } from '../../imaging/wall.ts'
import { withoutMod } from '../../imaging/window.ts'
import { useEditor, type BackdropChoice, type CanvasView } from '../../state/editor.ts'
import { useRenderedPainting } from '../../state/useRenderedPainting.ts'
import { autoBackdrop, type BackdropKind } from '../../ui/backdrop.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { Segmented } from '../../ui/Segmented.tsx'
import styles from './CanvasStage.module.css'

export type PixelPhase = 'down' | 'move' | 'up'

/** Where the painting sits on screen: CSS pixels per painting pixel, and its pixel size. */
export interface StageGeometry {
  scale: number
  width: number
  height: number
}

export interface CanvasStageProps {
  /**
   * Called with painting pixel coordinates while the pointer is pressed on the painting in the
   * Editor view: once with 'down' (always on the painting), with 'move' while dragging, then 'up'.
   * Moves and 'up' are not clamped: a drag past the edge reports pixels outside the painting.
   */
  onPixel?(x: number, y: number, phase: PixelPhase, event: ReactPointerEvent<HTMLElement>): void
  /** Drawn over the painting in the Editor view, sized to it (e.g. a selection outline). */
  overlay?(geometry: StageGeometry): ReactNode
  /** Extra items for the line under the canvas. */
  footer?: ReactNode
  /** Controls floating over the canvas's top-left corner (the pixel tools), in the Editor view. */
  tools?: ReactNode
}

const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]
/** Room kept around the painting when fitting it. */
const FIT_MARGIN = 32
/** Extra room on the left for the tools column (matches the CSS padding). */
const TOOLS_ROOM = 56
/** The pixel grid only shows once pixels are at least this many CSS pixels wide. */
const GRID_MIN_SCALE = 4

function fitScale(raster: Raster, box: { width: number; height: number }): number {
  const contain = Math.min(
    (box.width - FIT_MARGIN) / raster.width,
    (box.height - FIT_MARGIN) / raster.height,
  )
  if (!Number.isFinite(contain) || contain <= 0) return 1
  return contain >= 1 ? Math.floor(contain) : contain
}

function nextZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > scale + 1e-6) ?? scale
  return [...ZOOM_STEPS].reverse().find((z) => z < scale - 1e-6) ?? scale
}

/** Painting pixel under the pointer; clamped to the painting only when asked. */
function pixelAt(
  event: ReactPointerEvent<HTMLElement>,
  width: number,
  height: number,
  clamp: boolean,
) {
  const rect = event.currentTarget.getBoundingClientRect()
  const fx = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
  const fy = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
  const x = Math.floor(fx * width)
  const y = Math.floor(fy * height)
  if (!clamp) return { x, y }
  return { x: Math.min(width - 1, Math.max(0, x)), y: Math.min(height - 1, Math.max(0, y)) }
}

/** Size of an element, kept up to date while it resizes. */
function useBoxSize(ref: { current: HTMLElement | null }) {
  const [size, setSize] = useState({ width: 640, height: 480 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export function CanvasStage({ onPixel, overlay, footer, tools }: CanvasStageProps) {
  const t = useT()
  const painting = useEditor((s) => s.painting)
  const view = useEditor((s) => s.view)
  const backdrop = useEditor((s) => s.backdrop)
  const zoom = useEditor((s) => s.zoom)
  const showGrid = useEditor((s) => s.showGrid)
  const rendered = useRenderedPainting()
  const area = useRef<HTMLDivElement>(null)
  const box = useBoxSize(area)
  const drawing = useRef(false)
  const lastPixel = useRef({ x: 0, y: 0 })

  const material = painting?.recipe.frame.material ?? 'dark_oak'
  const kind: BackdropKind = backdrop === 'auto' ? autoBackdrop(material) : backdrop

  const blocksW = painting?.width ?? 1
  const blocksH = painting?.height ?? 1
  const ppb = painting?.pixelsPerBlock ?? 1
  const wall = useMemo(
    () =>
      view === 'wall' && rendered.raster
        ? renderWallPreview(rendered.raster, blocksW, blocksH, ppb)
        : null,
    [view, rendered.raster, blocksW, blocksH, ppb],
  )

  // The no-mod look is only worked out while it is the view.
  const nomod = useMemo(
    () => (view === 'nomod' && rendered.raster ? withoutMod(rendered.raster) : null),
    [view, rendered.raster],
  )
  const shown = view === 'nomod' ? nomod : rendered.raster
  const withTools = tools !== undefined && view === 'edit'
  const fitBox = withTools ? { width: box.width - TOOLS_ROOM, height: box.height } : box
  const fit = shown ? fitScale(shown, fitBox) : 1
  const scale = zoom > 0 ? zoom : fit

  // Ctrl + wheel zooms; React wheel listeners are passive, so this one is attached by hand.
  const scaleRef = useRef(scale)
  useEffect(() => {
    scaleRef.current = scale
  })
  useEffect(() => {
    const el = area.current
    if (!el) return
    function onWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey) || useEditor.getState().view === 'wall') return
      event.preventDefault()
      useEditor.getState().setZoom(nextZoom(scaleRef.current, event.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!painting) return null

  const viewOptions: Array<{ value: CanvasView; label: string }> = [
    { value: 'edit', label: t.editor.views.edit },
    { value: 'wall', label: t.editor.views.wall },
    { value: 'nomod', label: t.editor.views.nomod },
  ]
  const backdropOptions: Array<{ value: BackdropChoice; label: string }> = [
    { value: 'auto', label: t.editor.backdrop.auto },
    { value: 'light', label: t.editor.backdrop.light },
    { value: 'dark', label: t.editor.backdrop.dark },
    { value: 'sky', label: t.editor.backdrop.sky },
  ]
  const editor = useEditor.getState()
  const zoomable = view !== 'wall'

  /**
   * Strokes always end with one 'up': on pointer up, cancel, or a lost pointer capture (which
   * carries no useful position, so the last pixel is reported). Each stroke is one undo step.
   */
  function handlePointer(
    event: ReactPointerEvent<HTMLElement>,
    phase: PixelPhase,
    atLastPixel = false,
  ) {
    if (!onPixel || view !== 'edit' || !shown) return
    if (phase === 'down') {
      if (event.button !== 0) return
      drawing.current = true
      useEditor.getState().endGesture()
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } else if (!drawing.current) return
    const { x, y } = atLastPixel
      ? lastPixel.current
      : pixelAt(event, shown.width, shown.height, phase === 'down')
    lastPixel.current = { x, y }
    if (phase === 'up') drawing.current = false
    onPixel(x, y, phase, event)
    if (phase === 'up') useEditor.getState().endGesture()
  }

  let content: ReactNode = null
  if (view === 'wall') {
    content = wall && (
      <PaintingCanvas
        raster={wall}
        fit={{ width: box.width - FIT_MARGIN, height: box.height - FIT_MARGIN }}
        label={t.editor.wallLabel}
      />
    )
  } else if (shown) {
    const geometry: StageGeometry = { scale, width: shown.width, height: shown.height }
    const gridStyle = {
      '--pixel': `${scale}px`,
      '--block': `${scale * ppb}px`,
    } as CSSProperties
    content = (
      <div
        className={styles.painting}
        style={{ width: shown.width * scale, height: shown.height * scale }}
        onPointerDown={(e) => handlePointer(e, 'down')}
        onPointerMove={(e) => handlePointer(e, 'move')}
        onPointerUp={(e) => handlePointer(e, 'up')}
        onPointerCancel={(e) => handlePointer(e, 'up', true)}
        onLostPointerCapture={(e) => handlePointer(e, 'up', true)}
        data-tool={onPixel && view === 'edit' ? '' : undefined}
      >
        <PaintingCanvas
          raster={shown}
          scale={scale}
          label={view === 'nomod' ? t.editor.nomodLabel : t.editor.canvasLabel}
        />
        {showGrid && (
          <div
            className={styles.grid}
            data-pixels={scale >= GRID_MIN_SCALE || undefined}
            style={gridStyle}
            aria-hidden="true"
          />
        )}
        {view === 'edit' && overlay && <div className={styles.overlay}>{overlay(geometry)}</div>}
      </div>
    )
  }

  const backdropName =
    kind === 'light' || kind === 'dark' ? t.editor.backdropNames[kind] : t.editor.backdrop[kind]
  const note =
    backdrop === 'auto' && view !== 'wall'
      ? format(material === 'none' ? t.editor.backdropNoteNone : t.editor.backdropNote, {
          backdrop: backdropName,
          material: t.materials[material].toLowerCase(),
        })
      : null

  return (
    <section className={styles.stage} aria-label={t.editor.viewLabel}>
      <div className={styles.toolbar}>
        <Segmented
          label={t.editor.viewLabel}
          options={viewOptions}
          value={view}
          onChange={editor.setView}
        />
        <div className={styles.spacer} />
        {zoomable && (
          <div className={styles.zoom}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={showGrid}
              onClick={editor.toggleGrid}
            >
              {t.editor.pixelGrid}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t.editor.zoomOut}
              onClick={() => editor.setZoom(nextZoom(scale, -1))}
            >
              <Icon name="minus" />
            </button>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={zoom === 0}
              title={t.editor.zoomFit}
              onClick={() => editor.setZoom(0)}
            >
              <span className="visually-hidden">{t.editor.zoomFit}, </span>
              {format(t.editor.zoomLevel, { percent: Math.round(scale * 100) })}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t.editor.zoomIn}
              onClick={() => editor.setZoom(nextZoom(scale, 1))}
            >
              <Icon name="plus" />
            </button>
          </div>
        )}
        {view !== 'wall' && (
          <div className={styles.backdrop}>
            <span className={styles.label}>{t.editor.backdrop.label}</span>
            <Segmented
              label={t.editor.backdrop.label}
              options={backdropOptions}
              value={backdrop}
              onChange={editor.setBackdrop}
            />
          </div>
        )}
      </div>

      <div ref={area} className={styles.area} data-view={view} data-tools={withTools || undefined}>
        <Backdrop kind={view === 'wall' ? 'mid' : kind} className={styles.surface}>
          <div className={styles.center}>{content}</div>
        </Backdrop>
        {withTools && <div className={styles.tools}>{tools}</div>}
      </div>

      <p className={styles.foot}>
        {rendered.failed && (
          <span className={styles.failed} role="alert">
            {t.editor.renderFailed}
          </span>
        )}
        <span>
          {t.editor.transparentPixels}{' '}
          <b>{format(t.editor.percent, { value: Math.round(rendered.transparent * 100) })}</b>
        </span>
        {note && (
          <>
            <span aria-hidden="true">·</span>
            <span>{note}</span>
          </>
        )}
        {footer}
      </p>
    </section>
  )
}
