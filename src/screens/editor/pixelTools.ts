import { createEditLayer, resampleEdits, type EditLayer } from '../../imaging/edits.ts'
import type { Raster, RGBA } from '../../imaging/raster.ts'
import { copyLayer, eyedropper, paintMask, pencilInto, selectSimilar } from '../../imaging/tools.ts'
import { useEditor, type Tool } from '../../state/editor.ts'
import {
  beginStroke,
  currentRaster,
  endStroke,
  previewStroke,
} from '../../state/useRenderedPainting.ts'
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

type Point = [number, number]

/**
 * Paints a stroke segment into the edits (one undo step per stroke) and shows it at once over
 * the last render: no full render until the stroke ends.
 *
 * A stroke paints into its own copy of the edits, made when it starts, instead of copying the
 * whole layer on every frame (which made the garbage collector stall the stroke). Each frame
 * still commits a new layer object around those pixels, so identity checks see the change; the
 * history only keeps the layer from before the stroke (its moves merge into one undo step),
 * so no layer anything else holds changes underneath it.
 */
function paintStroke(stroke: Stroke, points: Point[]): void {
  if (!stroke.layer || useEditor.getState().edits !== stroke.committed) {
    // First paint, or the edits changed meanwhile (an undo): start from what is there now.
    const base = editableLayer()
    if (!base) return
    stroke.layer = copyLayer(base)
  }
  pencilInto(stroke.layer, points, stroke.color)
  const layer: EditLayer = { values: stroke.layer.values, mask: stroke.layer.mask }
  useEditor.getState().setEdits(layer, STROKE)
  stroke.committed = layer
  const xs = points.map((p) => Math.round(p[0]))
  const ys = points.map((p) => Math.round(p[1]))
  previewStroke(layer, {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  })
}

/** A pencil or eraser stroke in progress. */
export interface Stroke {
  /** Last pixel already painted, or null between strokes. */
  last: Point | null
  /** Pixels reached since, painted on the next animation frame. */
  pending: Point[]
  color: RGBA
  cancelFrame: (() => void) | null
  /** The stroke's own working copy of the edits, and the layer it last committed. */
  layer: EditLayer | null
  committed: EditLayer | null
}

export const newStroke = (): Stroke => ({
  last: null,
  pending: [],
  color: TRANSPARENT,
  cancelFrame: null,
  layer: null,
  committed: null,
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
  paintStroke(stroke, [last, ...pending])
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
      beginStroke()
      paintStroke(stroke, [[x, y]])
      return
    }
    if (!stroke.last) return
    const reached = stroke.pending.at(-1) ?? stroke.last
    if (reached[0] !== x || reached[1] !== y) stroke.pending.push([x, y])
    if (phase === 'up') {
      flushStroke(stroke)
      stroke.last = null
      endStroke()
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
