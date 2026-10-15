import { create } from 'zustand'
import { createEditLayer, resampleEdits, type EditLayer } from '../../imaging/edits.ts'
import type { Raster, RGBA } from '../../imaging/raster.ts'
import { eyedropper, paintMask, pencil, selectSimilar } from '../../imaging/tools.ts'
import { useEditor, type Tool } from '../../state/editor.ts'
import { currentRaster } from '../../state/useRenderedPainting.ts'
import { TRANSPARENT } from './color.ts'
import type { PixelPhase } from './CanvasStage.tsx'

/** Tolerance is shown as 0..100 %, of the largest channel difference (0..255). */
export const toDistance = (tolerance: number) => Math.round((tolerance * 255) / 100)

/** Every pencil move of one stroke merges into one undo step. */
const STROKE = { merge: 'pixels.stroke', gesture: true } as const

/** The edit layer to paint into, at the painting's pixel size (never the stored one itself). */
function editableLayer(): EditLayer | null {
  const { painting, edits } = useEditor.getState()
  if (!painting) return null
  const width = painting.width * painting.pixelsPerBlock
  const height = painting.height * painting.pixelsPerBlock
  if (!edits) return createEditLayer(width, height)
  if (edits.values.width !== width || edits.values.height !== height) {
    return resampleEdits(edits, width, height)
  }
  return edits
}

/** Paints every selected pixel; a selection of another size (stale) is ignored. */
export function paintSelection(mask: Uint8Array, color: RGBA): void {
  const base = editableLayer()
  if (!base || mask.length !== base.mask.length) return
  useEditor.getState().setEdits(paintMask(base, mask, color))
}

/** The rendered painting the tools pick from; null (and logged) if it can't be rendered. */
function pickable(): Raster | null {
  try {
    return currentRaster()
  } catch (error) {
    console.error('Could not render the painting for the tool', error)
    return null
  }
}

function union(a: Uint8Array | null, b: Uint8Array): Uint8Array {
  if (!a || a.length !== b.length) return b
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = a[i] === 1 || b[i] === 1 ? 1 : 0
  return out
}

/** Whether a pencil or eraser stroke is in progress (previews that can wait pause meanwhile). */
export const useStroke = create<{ active: boolean }>(() => ({ active: false }))

type Point = [number, number]

/** A pencil or eraser stroke in progress. */
export interface Stroke {
  /** Last pixel already painted, or null between strokes. */
  last: Point | null
  /** Pixels reached since, painted on the next animation frame. */
  pending: Point[]
  color: RGBA
  cancelFrame: (() => void) | null
}

export const newStroke = (): Stroke => ({
  last: null,
  pending: [],
  color: TRANSPARENT,
  cancelFrame: null,
})

function nextFrame(task: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(task)
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(task, 16)
  return () => clearTimeout(handle)
}

/** Paints the pixels the stroke reached since the last frame, in one edit. */
function flushStroke(stroke: Stroke): void {
  stroke.cancelFrame?.()
  stroke.cancelFrame = null
  const { last, pending } = stroke
  const end = pending.at(-1)
  if (!last || !end) return
  stroke.pending = []
  stroke.last = end
  const base = editableLayer()
  if (base) useEditor.getState().setEdits(pencil(base, [last, ...pending], stroke.color), STROKE)
}

export interface ToolContext {
  stroke: Stroke
  /** Where the eyedropper goes back to once it picked a colour. */
  previousTool: Tool
  /** Shift held: the wand adds to the selection. */
  shift: boolean
}

/**
 * Runs the current tool at a painting pixel. Pencil and eraser draw while the pointer moves
 * (one undo step per stroke); the others act once, on 'down', on the rendered painting.
 */
export function applyToolAt(x: number, y: number, phase: PixelPhase, ctx: ToolContext): void {
  const editor = useEditor.getState()
  const { tool } = editor

  if (tool === 'pencil' || tool === 'eraser') {
    const stroke = ctx.stroke
    if (phase === 'down') {
      // The dot under the pointer shows at once; moves are batched per animation frame.
      stroke.cancelFrame?.()
      Object.assign(stroke, newStroke(), {
        last: [x, y],
        color: tool === 'eraser' ? TRANSPARENT : editor.color,
      })
      useStroke.setState({ active: true })
      const base = editableLayer()
      if (base) editor.setEdits(pencil(base, [[x, y]], stroke.color), STROKE)
      return
    }
    if (!stroke.last) return
    const reached = stroke.pending.at(-1) ?? stroke.last
    if (reached[0] !== x || reached[1] !== y) stroke.pending.push([x, y])
    if (phase === 'up') {
      flushStroke(stroke)
      stroke.last = null
      useStroke.setState({ active: false })
    } else if (!stroke.cancelFrame && stroke.pending.length > 0) {
      stroke.cancelFrame = nextFrame(() => {
        stroke.cancelFrame = null
        flushStroke(stroke)
      })
    }
    return
  }

  if (phase !== 'down') return
  const raster = pickable()
  if (!raster) return
  const distance = toDistance(editor.tolerance)

  if (tool === 'eyedropper') {
    editor.setColor(eyedropper(raster, x, y))
    editor.setTool(ctx.previousTool)
  } else if (tool === 'wand') {
    const picked = selectSimilar(raster, x, y, distance, editor.contiguous)
    editor.setSelection(ctx.shift ? union(editor.selection, picked) : picked)
  } else {
    const contiguous = tool === 'fill' && editor.contiguous
    paintSelection(selectSimilar(raster, x, y, distance, contiguous), editor.color)
  }
}

/**
 * SVG path data tracing the edges between selected and unselected pixels, in painting pixels:
 * horizontal runs for each row boundary, then vertical runs for each column boundary.
 */
export function outlinePath(mask: Uint8Array, width: number, height: number): string {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? (mask[y * width + x] ?? 0) : 0
  const parts: string[] = []
  for (let y = 0; y <= height; y++) {
    let x = 0
    while (x < width) {
      if (at(x, y - 1) === at(x, y)) {
        x++
        continue
      }
      const start = x
      while (x < width && at(x, y - 1) !== at(x, y)) x++
      parts.push(`M${start} ${y}H${x}`)
    }
  }
  for (let x = 0; x <= width; x++) {
    let y = 0
    while (y < height) {
      if (at(x - 1, y) === at(x, y)) {
        y++
        continue
      }
      const start = y
      while (y < height && at(x - 1, y) !== at(x, y)) y++
      parts.push(`M${x} ${start}V${y}`)
    }
  }
  return parts.join('')
}
