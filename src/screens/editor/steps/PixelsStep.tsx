import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { DYE_IDS } from '../../../domain/types.ts'
import { format, plural, useT } from '../../../i18n/i18n.ts'
import type { RGBA } from '../../../imaging/raster.ts'
import { BRUSH_SIZES, maskSize } from '../../../imaging/tools.ts'
import { renderWallPreview } from '../../../imaging/wall.ts'
import { DEFAULT_TOLERANCE, useEditor, type Tool } from '../../../state/editor.ts'
import { endStroke, useRenderedPainting } from '../../../state/useRenderedPainting.ts'
import { Button } from '../../../ui/Button.tsx'
import { Icon } from '../../../ui/Icon.tsx'
import { PaintingCanvas } from '../../../ui/PaintingCanvas.tsx'
import { Segmented } from '../../../ui/Segmented.tsx'
import { Slider } from '../../../ui/Slider.tsx'
import { CanvasStage, type StageGeometry } from '../CanvasStage.tsx'
import {
  cssColor,
  dyeColor,
  frameColor,
  GLASS_25,
  GLASS_50,
  sameColor,
  TRANSPARENT,
} from '../color.ts'
import { ColorPicker } from '../ColorPicker.tsx'
import {
  applyToolAt,
  newStroke,
  outlinePath,
  paintSelection,
  type ToolContext,
} from '../pixelTools.ts'
import styles from './steps.module.css'
import own from './PixelsStep.module.css'

const TOOLS: Array<{ tool: Tool; key: string }> = [
  { tool: 'pencil', key: 'B' },
  { tool: 'fill', key: 'G' },
  { tool: 'replace', key: 'R' },
  { tool: 'wand', key: 'W' },
  { tool: 'eyedropper', key: 'I' },
  { tool: 'eraser', key: 'E' },
]

const toolKey = (tool: Tool) => TOOLS.find((entry) => entry.tool === tool)?.key ?? ''

/** Tools that pick pixels by colour use the tolerance (and, but replace, contiguity). */
const BY_COLOR = new Set<Tool>(['fill', 'replace', 'wand'])
/** Tools that paint with the square brush. */
const BRUSHED = new Set<Tool>(['pencil', 'eraser'])

/** The in-game preview stays compact, so the inspector shows it without scrolling (N4). */
const WALL_PREVIEW = { width: 290, height: 110 }

/** The canvas of the Colors & pixels step: tools column, tool handling, selection outline. */
export function PixelsStage() {
  const t = useT()
  const tool = useEditor((s) => s.tool)
  const brush = useEditor((s) => s.brush)
  const selection = useEditor((s) => s.selection)
  const count = useMemo(() => (selection ? maskSize(selection) : 0), [selection])
  const ctx = useRef<ToolContext>({ stroke: newStroke(), previousTool: 'pencil', shift: false })

  // Leaving the step mid-stroke: drop the frame still to come and let previews resume.
  useEffect(() => {
    const stroke = ctx.current.stroke
    return () => {
      stroke.cancelFrame?.()
      stroke.cancelFrame = null
      endStroke()
    }
  }, [])

  // The eyedropper goes back to whichever tool was in use before it.
  useEffect(() => {
    if (tool !== 'eyedropper') ctx.current.previousTool = tool
  }, [tool])

  const tools = (
    <div className={own.tools} role="toolbar" aria-label={t.editor.pixels.tools}>
      {TOOLS.map(({ tool: id, key }) => {
        const label = format(t.editor.pixels.toolHint, { tool: t.editor.tools[id], key })
        return (
          <button
            key={id}
            type="button"
            className={own.tool}
            aria-label={t.editor.tools[id]}
            aria-keyshortcuts={key}
            aria-pressed={tool === id}
            title={label}
            onClick={() => useEditor.getState().setTool(id)}
          >
            <Icon name={id} size={18} />
          </button>
        )
      })}
    </div>
  )

  const hint = format(t.editor.pixels.toolHelp, {
    tool: t.editor.tools[tool],
    how: t.editor.toolHow[tool],
    key: toolKey(tool),
  })

  return (
    <CanvasStage
      tools={tools}
      brush={BRUSHED.has(tool) ? brush : undefined}
      hint={hint}
      floating={selection && count > 0 && <SelectionBar selection={selection} count={count} />}
      onPixel={(x, y, phase, event) => {
        ctx.current.shift = event.shiftKey
        applyToolAt(x, y, phase, ctx.current)
      }}
      overlay={(geometry) =>
        selection && <SelectionOutline selection={selection} geometry={geometry} />
      }
    />
  )
}

/**
 * What to do with the selection, right next to it (I7): make it see-through (the headline
 * job), fill it with the current colour, or let it go.
 */
function SelectionBar({ selection, count }: { selection: Uint8Array; count: number }) {
  const t = useT()
  const color = useEditor((s) => s.color)
  return (
    <div className={own.selectionBar} role="toolbar" aria-label={t.editor.pixels.selection}>
      <span className={own.selectionCount}>{plural(t, t.editor.pixels.selected, count)}</span>
      <Button variant="primary" onClick={() => paintSelection(selection, TRANSPARENT)}>
        {t.editor.pixels.makeTransparent}
      </Button>
      <Button onClick={() => paintSelection(selection, color)}>
        <i
          className={own.chip}
          style={{ '--swatch': cssColor(color) } as CSSProperties}
          aria-hidden="true"
        />
        {t.editor.pixels.fillWithColor}
      </Button>
      <Button variant="ghost" onClick={() => useEditor.getState().setSelection(null)}>
        {t.editor.pixels.clear}
      </Button>
    </div>
  )
}

function SelectionOutline({
  selection,
  geometry,
}: {
  selection: Uint8Array
  geometry: StageGeometry
}) {
  const { width, height } = geometry
  const path = useMemo(
    () => (selection.length === width * height ? outlinePath(selection, width, height) : ''),
    [selection, width, height],
  )
  if (!path) return null
  return (
    <svg
      className={own.outline}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className={own.outlineLine} d={path} />
      <path className={own.outlineDash} d={path} />
    </svg>
  )
}

/**
 * The options of the current tool, in a slot of fixed height: switching tools never moves the
 * colour picker below (M5).
 */
function ToolOptions() {
  const t = useT()
  const id = useId()
  const tool = useEditor((s) => s.tool)
  const brush = useEditor((s) => s.brush)
  const tolerance = useEditor((s) => s.tolerance)
  const contiguous = useEditor((s) => s.contiguous)
  const editor = useEditor.getState()

  let options = <p className={styles.hint}>{t.editor.toolHow[tool]}</p>
  if (BRUSHED.has(tool)) {
    options = (
      <Segmented
        label={t.editor.pixels.brushSize}
        options={BRUSH_SIZES.map((size) => ({
          value: String(size),
          label: format(t.editor.pixels.brushValue, { size }),
        }))}
        value={String(brush)}
        onChange={(size) => editor.setBrush(Number(size))}
      />
    )
  } else if (BY_COLOR.has(tool)) {
    options = (
      <>
        <div onPointerUp={() => editor.endGesture()}>
          <Slider
            id={`${id}-tolerance`}
            label={t.editor.pixels.tolerance}
            min={0}
            max={100}
            value={tolerance}
            defaultValue={DEFAULT_TOLERANCE}
            unit="%"
            onChange={editor.setTolerance}
          />
        </div>
        {tool !== 'replace' && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={contiguous}
              onChange={(event) => editor.setContiguous(event.currentTarget.checked)}
            />
            {t.editor.pixels.contiguous}
          </label>
        )}
      </>
    )
  }

  return (
    <section className={own.options} aria-labelledby={`${id}-tool`}>
      <h2 id={`${id}-tool`} className={styles.subheading}>
        {t.editor.tools[tool]}
      </h2>
      {options}
    </section>
  )
}

/** The inspector of the Colors & pixels step. */
export function PixelsPanel() {
  const t = useT()
  const id = useId()
  const painting = useEditor((s) => s.painting)
  const color = useEditor((s) => s.color)
  const selection = useEditor((s) => s.selection)
  const count = useMemo(() => (selection ? maskSize(selection) : 0), [selection])
  const rendered = useRenderedPainting()
  const blocksW = painting?.width ?? 1
  const blocksH = painting?.height ?? 1
  const ppb = painting?.pixelsPerBlock ?? 1
  // The wall preview waits for a stroke's own render: it would cost as much as the stroke itself.
  const [wallSource, setWallSource] = useState(rendered.raster)
  if (!rendered.drawing && wallSource !== rendered.raster) setWallSource(rendered.raster)
  // Drawn in a later, lower-priority render: the painting itself shows first.
  const wallInput = useDeferredValue(wallSource)
  const wall = useMemo(
    () => wallInput && renderWallPreview(wallInput, blocksW, blocksH, ppb),
    [wallInput, blocksW, blocksH, ppb],
  )
  if (!painting) return null

  const editor = useEditor.getState()
  const presets: Array<{ key: string; label: string; color: RGBA }> = [
    { key: 'transparent', label: t.editor.pixels.transparent, color: TRANSPARENT },
    { key: 'glass25', label: t.editor.pixels.glass25, color: GLASS_25 },
    { key: 'glass50', label: t.editor.pixels.glass50, color: GLASS_50 },
    {
      key: 'frame',
      label: t.editor.pixels.framePreset,
      color: frameColor(painting.recipe.frame.material),
    },
  ]

  return (
    <>
      {/* First, so the result of an edit is in view without scrolling (N4). */}
      <figure className={own.wall}>
        {wall && (
          <PaintingCanvas raster={wall} fit={WALL_PREVIEW} label={t.editor.pixels.wallPreview} />
        )}
      </figure>

      <ToolOptions />

      <section className={styles.section} aria-labelledby={`${id}-color`}>
        <h2 id={`${id}-color`} className={styles.subheading}>
          {t.editor.pixels.color}
        </h2>
        <ColorPicker color={color} onChange={editor.setColor} />
        <h3 id={`${id}-presets`} className={styles.subheading}>
          {t.editor.pixels.presets}
        </h3>
        <div className={own.presets} role="group" aria-labelledby={`${id}-presets`}>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className={own.preset}
              aria-pressed={sameColor(p.color, color)}
              onClick={() => editor.setColor(p.color)}
            >
              <i
                className={own.chip}
                style={{ '--swatch': cssColor(p.color) } as CSSProperties}
                aria-hidden="true"
              />
              {p.label}
            </button>
          ))}
        </div>
        <h3 className={styles.subheading}>{t.editor.pixels.dyes}</h3>
        <div className={own.dyes} role="group" aria-label={t.editor.pixels.dyes}>
          {DYE_IDS.map((dye) => {
            const c = dyeColor(dye)
            return (
              <button
                key={dye}
                type="button"
                className={own.dye}
                style={{ '--swatch': cssColor(c) } as CSSProperties}
                aria-label={t.dyes[dye]}
                aria-pressed={sameColor(c, color)}
                title={t.dyes[dye]}
                onClick={() => editor.setColor(c)}
              />
            )
          })}
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.hint} aria-live="polite">
          {count > 0 ? plural(t, t.editor.pixels.selected, count) : t.editor.pixels.noSelection}
        </p>
        <div className={styles.row}>
          <Button
            className={own.apply}
            disabled={!selection || count === 0}
            onClick={() => {
              if (selection) paintSelection(selection, color)
            }}
          >
            {t.editor.pixels.applyToSelection}
          </Button>
          <Button
            variant="ghost"
            className={own.apply}
            disabled={!selection}
            onClick={() => editor.setSelection(null)}
          >
            {t.editor.pixels.clearSelection}
          </Button>
        </div>
      </section>
    </>
  )
}
