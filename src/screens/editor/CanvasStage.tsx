import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { format, useT } from '../../i18n/i18n.ts'
import type { Raster } from '../../imaging/raster.ts'
import { brushCentre, brushFootprint } from '../../imaging/tools.ts'
import { renderWallPreview } from '../../imaging/wall.ts'
import { withoutMod } from '../../imaging/window.ts'
import { useEditor, type BackdropChoice, type CanvasView } from '../../state/editor.ts'
import { strokeDrawn, useRenderedPainting } from '../../state/useRenderedPainting.ts'
import { autoBackdrop, type BackdropKind } from '../../ui/backdrop.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Button } from '../../ui/Button.tsx'
import { FileDrop } from '../../ui/FileDrop.tsx'
import { isTextEntry } from '../../ui/keyboard.ts'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { Segmented } from '../../ui/Segmented.tsx'
import styles from './CanvasStage.module.css'
import { IMAGE_TYPES, loadPicture } from './pictureActions.ts'
import { anchoredScroll, anchorPoint, nextZoom } from './stageZoom.ts'

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
  /** Side of the brush in painting pixels: its outline follows the pointer over the painting. */
  brush?: number
  /** One line under the canvas, in the Editor view: how the current tool works. */
  hint?: ReactNode
  /** Floats over the bottom of the canvas in the Editor view (the selection bar). */
  floating?: ReactNode
}

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

/** Where the pointer is over the painting, in fractional painting pixels. */
function exactAt(event: ReactPointerEvent<HTMLElement>, width: number, height: number) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * width : 0,
    y: rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * height : 0,
  }
}

/**
 * The painting pixel the pointer works on: the one under it, or with a brush the one the brush
 * is centred on (see `brushCentre`). Clamped to the painting only when asked.
 */
function pixelAt(
  event: ReactPointerEvent<HTMLElement>,
  width: number,
  height: number,
  clamp: boolean,
  brush?: number,
) {
  const exact = exactAt(event, width, height)
  const x = brush === undefined ? Math.floor(exact.x) : brushCentre(exact.x, brush)
  const y = brush === undefined ? Math.floor(exact.y) : brushCentre(exact.y, brush)
  if (!clamp) return { x, y }
  return { x: Math.min(width - 1, Math.max(0, x)), y: Math.min(height - 1, Math.max(0, y)) }
}

/** CSS pixels an arrow key moves the view (Shift: a screenful-ish). */
const ARROW_STEP = 48
const ARROW_STEP_BIG = 240
/** Room kept under the painting for the floating bar while it shows (matches the CSS). */
const FLOATING_ROOM = 72

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

type ZoomTo = (next: number, at?: { x: number; y: number }) => void

export function CanvasStage({
  onPixel,
  overlay,
  footer,
  tools,
  brush,
  hint,
  floating,
}: CanvasStageProps) {
  const t = useT()
  const painting = useEditor((s) => s.painting)
  const view = useEditor((s) => s.view)
  const backdrop = useEditor((s) => s.backdrop)
  const zoom = useEditor((s) => s.zoom)
  const showGrid = useEditor((s) => s.showGrid)
  // Nothing to show yet: no picture and no pixels painted (I5).
  const empty = useEditor((s) => s.painting?.recipe.source === null && s.edits === null)
  const rendered = useRenderedPainting()
  const area = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const paintingBox = useRef<HTMLDivElement>(null)
  const brushOutline = useRef<HTMLDivElement>(null)
  const box = useBoxSize(area)
  const drawing = useRef(false)
  const lastPixel = useRef({ x: 0, y: 0 })
  /** Where the pointer is over the painting (fractional pixels), for the brush outline. */
  const hover = useRef<{ x: number; y: number } | null>(null)
  /** A zoom waiting for its layout: the painting point to bring back under a screen point. */
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  /** Space held over the canvas ('ready'), or the view being dragged ('active'). */
  const [pan, setPan] = useState<'ready' | 'active' | null>(null)
  const panning = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(
    null,
  )
  const pointerOver = useRef(false)
  const spaceHeld = useRef(false)
  const pannable = useRef(false)

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
  const withFloating = Boolean(floating) && view === 'edit'
  // The tools column and the floating bar keep their room: the fitted painting is never under them.
  const fitBox = {
    width: box.width - (withTools ? TOOLS_ROOM : 0),
    height: box.height - (withFloating ? FLOATING_ROOM : 0),
  }
  const fit = shown ? fitScale(shown, fitBox) : 1
  const scale = zoom > 0 ? zoom : fit
  const zoomable = view !== 'wall'
  useEffect(() => {
    pannable.current = zoomable
  })
  const showsBrush = brush !== undefined && onPixel !== undefined && view === 'edit'

  /**
   * Zooms to `next`, keeping the painting point under `at` (client coordinates) where it is: the
   * pointer for the wheel, the middle of the view for the buttons (I8).
   */
  const zoomTo = useRef<ZoomTo>(() => {})
  useEffect(() => {
    zoomTo.current = (next, at) => {
      const view = surface.current?.getBoundingClientRect()
      const box = paintingBox.current?.getBoundingClientRect()
      if (view && box && next !== scale) {
        const point = at ?? { x: view.left + view.width / 2, y: view.top + view.height / 2 }
        anchor.current = {
          x: point.x,
          y: point.y,
          px: anchorPoint({ paintingStart: box.left, scale, anchor: point.x }),
          py: anchorPoint({ paintingStart: box.top, scale, anchor: point.y }),
        }
      }
      useEditor.getState().setZoom(next)
    }
  })

  // Once the new size is laid out, the view scrolls the anchored point back into place.
  useLayoutEffect(() => {
    const wanted = anchor.current
    anchor.current = null
    const view = surface.current
    const box = paintingBox.current?.getBoundingClientRect()
    if (!wanted || !view || !box) return
    view.scrollLeft = anchoredScroll({
      scroll: view.scrollLeft,
      paintingStart: box.left,
      scale,
      point: wanted.px,
      anchor: wanted.x,
    })
    view.scrollTop = anchoredScroll({
      scroll: view.scrollTop,
      paintingStart: box.top,
      scale,
      point: wanted.py,
      anchor: wanted.y,
    })
  }, [scale])

  // Ctrl + wheel zooms at the pointer; React wheel listeners are passive, so this one is
  // attached by hand.
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
      const next = nextZoom(scaleRef.current, event.deltaY < 0 ? 1 : -1)
      zoomTo.current(next, { x: event.clientX, y: event.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * Space makes the canvas a hand (dragging moves the view) while the canvas has the focus, or
   * nothing does and the pointer is over it: a focused button or field keeps its Space.
   */
  useEffect(() => {
    function armsSpace(event: KeyboardEvent): boolean {
      if (event.key !== ' ' || !pannable.current || isTextEntry(event.target)) return false
      const focused = document.activeElement
      const stage = area.current
      if (!stage) return false
      if (focused === stage || surface.current?.contains(focused)) return true
      return (focused === null || focused === document.body) && pointerOver.current
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!armsSpace(event)) return
      // The page must not scroll.
      event.preventDefault()
      if (spaceHeld.current) return
      spaceHeld.current = true
      setPan((p) => p ?? 'ready')
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== ' ' || !spaceHeld.current) return
      event.preventDefault()
      spaceHeld.current = false
      if (!panning.current) setPan(null)
    }
    function onBlur() {
      spaceHeld.current = false
      if (!panning.current) setPan(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /** Puts the brush outline over the pixels the brush would paint, or hides it. */
  function placeBrush() {
    const el = brushOutline.current
    if (!el) return
    const at = hover.current
    if (!at || brush === undefined || pan !== null) {
      el.style.display = 'none'
      return
    }
    // The same pixels the brush paints: centred from the exact pointer position.
    const footprint = brushFootprint(brushCentre(at.x, brush), brushCentre(at.y, brush), brush)
    el.style.display = 'block'
    el.style.transform = `translate(${footprint.x0 * scale}px, ${footprint.y0 * scale}px)`
    el.style.width = `${brush * scale}px`
    el.style.height = `${brush * scale}px`
  }

  // A new brush size or zoom moves the outline without waiting for the pointer.
  useEffect(placeBrush)

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

  /** Starts dragging the view: middle button, or the left one while Space is held. */
  function startPan(event: ReactPointerEvent<HTMLElement>) {
    const el = surface.current
    if (!zoomable || !el) return
    if (!(event.button === 1 || (event.button === 0 && spaceHeld.current))) return
    // The painting under the pointer must not take this press.
    event.preventDefault()
    event.stopPropagation()
    area.current?.focus({ preventScroll: true })
    panning.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPan('active')
  }

  function movePan(event: ReactPointerEvent<HTMLElement>) {
    const drag = panning.current
    const el = surface.current
    if (!drag || drag.id !== event.pointerId || !el) return
    el.scrollLeft = drag.left - (event.clientX - drag.x)
    el.scrollTop = drag.top - (event.clientY - drag.y)
  }

  function endPan(event: ReactPointerEvent<HTMLElement>) {
    if (panning.current?.id !== event.pointerId) return
    panning.current = null
    setPan(spaceHeld.current ? 'ready' : null)
  }

  /** Arrow keys move the view while the canvas itself has the focus (Shift: farther). */
  function moveWithKeys(event: ReactKeyboardEvent<HTMLElement>) {
    const el = surface.current
    if (!zoomable || !el || event.target !== event.currentTarget) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const step = event.shiftKey ? ARROW_STEP_BIG : ARROW_STEP
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    el.scrollLeft += move[0]
    el.scrollTop += move[1]
  }

  /** Remembers the painting pixel under the pointer for the brush outline. */
  function trackHover(event: ReactPointerEvent<HTMLElement>) {
    if (!showsBrush || !shown) return
    hover.current = exactAt(event, shown.width, shown.height)
    placeBrush()
  }

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
      // The canvas takes the focus: Space and the arrow keys now move the view.
      area.current?.focus({ preventScroll: true })
    } else if (!drawing.current) return
    const { x, y } = atLastPixel
      ? lastPixel.current
      : pixelAt(event, shown.width, shown.height, phase === 'down', showsBrush ? brush : undefined)
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
        ref={paintingBox}
        className={styles.painting}
        style={{ width: shown.width * scale, height: shown.height * scale }}
        onPointerDown={(e) => handlePointer(e, 'down')}
        onPointerMove={(e) => {
          trackHover(e)
          handlePointer(e, 'move')
        }}
        onPointerLeave={() => {
          hover.current = null
          placeBrush()
        }}
        onPointerUp={(e) => handlePointer(e, 'up')}
        onPointerCancel={(e) => handlePointer(e, 'up', true)}
        onLostPointerCapture={(e) => handlePointer(e, 'up', true)}
        data-tool={onPixel && view === 'edit' ? '' : undefined}
      >
        <PaintingCanvas
          raster={shown}
          scale={scale}
          label={view === 'nomod' ? t.editor.nomodLabel : t.editor.canvasLabel}
          // A stroke drawn in place: only what it changed is drawn again (the no-mod view is a
          // new raster each time, drawn whole).
          dirty={view === 'edit' ? rendered.dirty : null}
          onDrawn={strokeDrawn}
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
        {showsBrush && <div ref={brushOutline} className={styles.brush} aria-hidden="true" />}
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

  if (empty) return <EmptyStage />

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
        {/* Both groups stay in place in every view, so the canvas never moves (M5). */}
        <div className={styles.zoom} title={zoomable ? t.editor.zoomHint : undefined}>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={showGrid}
            disabled={!zoomable}
            onClick={editor.toggleGrid}
          >
            {t.editor.pixelGrid}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t.editor.zoomOut}
            disabled={!zoomable}
            onClick={() => zoomTo.current(nextZoom(scale, -1))}
          >
            <Icon name="minus" />
          </button>
          <span className={styles.zoomValue} data-disabled={!zoomable || undefined}>
            <span className="visually-hidden">{t.editor.zoom} </span>
            {format(t.editor.zoomLevel, { percent: Math.round(scale * 100) })}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t.editor.zoomIn}
            disabled={!zoomable}
            onClick={() => zoomTo.current(nextZoom(scale, 1))}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className={styles.chip}
            disabled={!zoomable || zoom === 0}
            onClick={() => editor.setZoom(0)}
          >
            {t.editor.zoomFit}
          </button>
        </div>
        <div className={styles.backdrop}>
          <span className={styles.label}>{t.editor.backdrop.label}</span>
          <Segmented
            label={t.editor.backdrop.label}
            options={backdropOptions}
            value={backdrop}
            disabled={!zoomable}
            onChange={editor.setBackdrop}
          />
        </div>
      </div>
      {/* Names the mod behind "see-through" (I12); always there, so the canvas never moves. */}
      <p className={styles.modNote}>{t.editor.modNote}</p>

      <div
        ref={area}
        className={styles.area}
        role="group"
        aria-label={zoomable ? t.editor.stageLabel : undefined}
        // Focusable, so keyboard players can move the view with the arrow keys.
        tabIndex={zoomable ? 0 : undefined}
        data-view={view}
        data-tools={withTools || undefined}
        data-floating={withFloating || undefined}
        data-pan={(zoomable && pan) || undefined}
        onKeyDown={moveWithKeys}
        onPointerEnter={() => {
          pointerOver.current = true
        }}
        onPointerLeave={() => {
          pointerOver.current = false
        }}
        onPointerDownCapture={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        onMouseDown={(event) => {
          // No browser autoscroll on a middle click: the middle button drags the view.
          if (event.button === 1) event.preventDefault()
        }}
      >
        <Backdrop ref={surface} kind={view === 'wall' ? 'mid' : kind} className={styles.surface}>
          <div className={styles.center}>{content}</div>
        </Backdrop>
        {withTools && <div className={styles.tools}>{tools}</div>}
        {view === 'edit' && floating && <div className={styles.floating}>{floating}</div>}
      </div>

      <p className={styles.foot}>
        {hint && view === 'edit' && <span className={styles.hint}>{hint}</span>}
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

/**
 * The stage of a painting without a picture: one card asking for one. The whole stage takes a
 * click (to browse) or a dropped picture; pasting works while focus is inside.
 */
function EmptyStage() {
  const t = useT()
  const fileInput = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const browse = () => fileInput.current?.click()

  return (
    <div className={styles.stage} data-empty="">
      <FileDrop
        accept={IMAGE_TYPES}
        onFiles={([file]) => {
          if (file) void loadPicture(file)
        }}
      >
        <section className={styles.empty} aria-labelledby={titleId} onClick={browse}>
          <div className={styles.emptyCard}>
            <Icon name="image" size={40} />
            <h2 id={titleId} className={styles.emptyTitle}>
              {t.editor.empty.title}
            </h2>
            <p className={styles.emptyHint}>{t.editor.empty.hint}</p>
            <Button
              variant="primary"
              icon="image"
              onClick={(event) => {
                // The stage around opens the same picker.
                event.stopPropagation()
                browse()
              }}
            >
              {t.editor.image.browse}
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES}
            hidden
            aria-label={t.editor.image.browse}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (file) void loadPicture(file)
            }}
          />
        </section>
      </FileDrop>
    </div>
  )
}
