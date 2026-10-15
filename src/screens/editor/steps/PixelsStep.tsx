import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react'
import { DYE_IDS } from '../../../domain/types.ts'
import { format, useT } from '../../../i18n/i18n.ts'
import type { RGBA } from '../../../imaging/raster.ts'
import { maskSize } from '../../../imaging/tools.ts'
import { renderWallPreview } from '../../../imaging/wall.ts'
import { useEditor, type Tool } from '../../../state/editor.ts'
import { useRenderedPainting } from '../../../state/useRenderedPainting.ts'
import { Button } from '../../../ui/Button.tsx'
import { Icon } from '../../../ui/Icon.tsx'
import { PaintingCanvas } from '../../../ui/PaintingCanvas.tsx'
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
import { applyToolAt, outlinePath, paintSelection, type ToolContext } from '../pixelTools.ts'
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

/** Tools that pick pixels by colour use the tolerance (and, but replace, contiguity). */
const BY_COLOR = new Set<Tool>(['fill', 'replace', 'wand'])

const WALL_PREVIEW = { width: 290, height: 170 }

/** The canvas of the Colors & pixels step: tools column, tool handling, selection outline. */
export function PixelsStage() {
  const t = useT()
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const count = useMemo(() => (selection ? maskSize(selection) : 0), [selection])
  const ctx = useRef<ToolContext>({ stroke: { last: null }, previousTool: 'pencil', shift: false })

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

  return (
    <CanvasStage
      tools={tools}
      onPixel={(x, y, phase, event) => {
        ctx.current.shift = event.shiftKey
        applyToolAt(x, y, phase, ctx.current)
      }}
      overlay={(geometry) =>
        selection && <SelectionOutline selection={selection} geometry={geometry} />
      }
      footer={
        count > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{format(t.editor.pixels.selected, { count })}</span>
          </>
        )
      }
    />
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

/** The inspector of the Colors & pixels step. */
export function PixelsPanel() {
  const t = useT()
  const id = useId()
  const painting = useEditor((s) => s.painting)
  const tool = useEditor((s) => s.tool)
  const color = useEditor((s) => s.color)
  const tolerance = useEditor((s) => s.tolerance)
  const contiguous = useEditor((s) => s.contiguous)
  const selection = useEditor((s) => s.selection)
  const count = useMemo(() => (selection ? maskSize(selection) : 0), [selection])
  const rendered = useRenderedPainting()
  const blocksW = painting?.width ?? 1
  const blocksH = painting?.height ?? 1
  const ppb = painting?.pixelsPerBlock ?? 1
  const wall = useMemo(
    () => rendered.raster && renderWallPreview(rendered.raster, blocksW, blocksH, ppb),
    [rendered.raster, blocksW, blocksH, ppb],
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
      {BY_COLOR.has(tool) && (
        <section className={styles.section} aria-label={t.editor.tools[tool]}>
          <div onPointerUp={() => editor.endGesture()}>
            <Slider
              id={`${id}-tolerance`}
              label={t.editor.pixels.tolerance}
              min={0}
              max={100}
              value={tolerance}
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
        </section>
      )}

      <section className={styles.section} aria-labelledby={`${id}-color`}>
        <h2 id={`${id}-color`} className={styles.heading}>
          {t.editor.pixels.color}
        </h2>
        <ColorPicker color={color} onChange={editor.setColor} />
      </section>

      <section className={styles.section} aria-labelledby={`${id}-presets`}>
        <h3 id={`${id}-presets`} className={styles.subheading}>
          {t.editor.pixels.presets}
        </h3>
        <div className={own.presets}>
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
          {count > 0 ? format(t.editor.pixels.selected, { count }) : t.editor.pixels.noSelection}
        </p>
        <div className={styles.row}>
          <Button
            variant="primary"
            className={own.apply}
            disabled={!selection || count === 0}
            onClick={() => {
              if (selection) paintSelection(selection, color)
            }}
          >
            {t.editor.pixels.applyToSelection}
          </Button>
          <Button disabled={!selection} onClick={() => editor.setSelection(null)}>
            {t.editor.pixels.clearSelection}
          </Button>
        </div>
      </section>

      {wall && (
        <figure className={own.wall}>
          <PaintingCanvas raster={wall} fit={WALL_PREVIEW} label={t.editor.pixels.wallPreview} />
        </figure>
      )}
    </>
  )
}
