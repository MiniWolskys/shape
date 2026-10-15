import type { FrameMaterial, ShapeId } from '../domain/types.ts'
import { FRAME_MATERIALS, LEAD_COLOR } from './materials.ts'
import { cloneRaster, createRaster, type Raster, type RGB } from './raster.ts'
import { makeShapeContext, SHAPES, type Classified } from './shapes.ts'

const LIGHT_WOOD: RGB = [214, 190, 150]
const RIVET_COLOR: RGB = [150, 120, 90]
const PAPER_COLOR: RGB = [244, 236, 214]

/** What each pixel of a window shape is, as codes into a table shared by every map. */
export interface ShapeMap {
  width: number
  height: number
  codes: Uint8Array
}

export interface ShapeOptions {
  shape: ShapeId
  /** Outer frame thickness in pixels (0 = none). */
  frame: number
  pixelsPerBlock: number
  seed: number
}

/** Every classification seen so far; shapes return shared constants, so this stays tiny. */
const KINDS: Classified[] = []
const CODES = new Map<Classified, number>()

function codeOf(c: Classified): number {
  let code = CODES.get(c)
  if (code === undefined) {
    code = KINDS.length
    if (code > 255) throw new RangeError('Too many pixel classifications')
    KINDS.push(c)
    CODES.set(c, code)
  }
  return code
}

/** Rows classified between two steps of `classifyShapeSteps` (a few ms at 1024 px wide). */
const ROWS_PER_STEP = 32

/**
 * Classifies every pixel of a w×h window shape (it does not depend on the picture), pausing
 * after every few rows so background work can give way.
 */
export function* classifyShapeSteps(
  width: number,
  height: number,
  o: ShapeOptions,
): Generator<void, ShapeMap> {
  const ctx = makeShapeContext(width, height, o.pixelsPerBlock, o.frame, o.seed)
  const classify = SHAPES[o.shape]
  const codes = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) codes[y * width + x] = codeOf(classify(x + 0.5, y + 0.5, ctx))
    if (y % ROWS_PER_STEP === ROWS_PER_STEP - 1) yield
  }
  return { width, height, codes }
}

/** Classifies every pixel of a w×h window shape at once. */
export function classifyShape(width: number, height: number, o: ShapeOptions): ShapeMap {
  const steps = classifyShapeSteps(width, height, o)
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

/** Thickest frame `reframeShape` can derive from a frameless map and its edge. */
export const FRAME_BOUND = 16

/**
 * The pixels a frame up to FRAME_BOUND can change: those classified differently without a frame
 * (`zero`) and with the thickest one (`bounded`). A frame only eats into the shape from its
 * edge, so deeper pixels look the same at every thickness up to the bound.
 */
export function shapeEdge(zero: ShapeMap, bounded: ShapeMap): Int32Array {
  const edge: number[] = []
  for (let p = 0; p < zero.codes.length; p++) if (zero.codes[p] !== bounded.codes[p]) edge.push(p)
  return Int32Array.from(edge)
}

/**
 * The map at another frame thickness (at most FRAME_BOUND), from the frameless map and its
 * edge: only the edge pixels are classified again, which is far cheaper than the whole shape.
 */
export function reframeShape(zero: ShapeMap, edge: Int32Array, o: ShapeOptions): ShapeMap {
  const { width, height } = zero
  if (o.frame > FRAME_BOUND) throw new RangeError(`Frame ${o.frame} is beyond ${FRAME_BOUND}`)
  const ctx = makeShapeContext(width, height, o.pixelsPerBlock, o.frame, o.seed)
  const classify = SHAPES[o.shape]
  const codes = new Uint8Array(zero.codes)
  if (o.frame > 0) {
    for (let k = 0; k < edge.length; k++) {
      const p = edge[k] ?? 0
      const x = p % width
      codes[p] = codeOf(classify(x + 0.5, (p - x) / width + 0.5, ctx))
    }
  }
  return { width, height, codes }
}

/** What painting does with a pixel of each kind. */
const OP_OUT = 0
const OP_GRAIN = 1
const OP_FIXED = 2
const OP_GLASS = 3

/**
 * Paints a classified window over the picture: `out` pixels become transparent (RGB = frame
 * colour), the frame and bars are opaque material colour with a deterministic grain, leads are
 * dark, and glass shows the picture at `glassOpacity`.
 */
export function paintWindow(
  picture: Raster,
  map: ShapeMap,
  o: { glassOpacity: number; material: FrameMaterial },
): Raster {
  const { width: w, height: h } = picture
  if (map.width !== w || map.height !== h) {
    throw new RangeError(`Shape is ${map.width}x${map.height}, picture is ${w}x${h}`)
  }
  const { color: frameRGB, grain } = FRAME_MATERIALS[o.material]
  const [fr, fg, fb] = frameRGB
  const opacity = Math.min(1, Math.max(0, o.glassOpacity))
  const src = picture.data
  const out = createRaster(w, h)
  const dst = out.data
  const codes = map.codes

  // What to do for each code, worked out once instead of per pixel: plain copy of a colour,
  // grained frame, or glass (with optional tint and paper).
  const n = KINDS.length
  const op = new Uint8Array(n)
  const fixed = new Float64Array(n * 3)
  const tint = new Float64Array(n * 3)
  const tinted = new Uint8Array(n)
  const paper = new Uint8Array(n)
  KINDS.forEach((c, k) => {
    let color: RGB | null = null
    if (c.kind === 'out') op[k] = OP_OUT
    else if (c.kind === 'frame') {
      color = c.rivet ? RIVET_COLOR : c.light ? LIGHT_WOOD : null
      op[k] = color ? OP_FIXED : OP_GRAIN
    } else if (c.kind === 'lead') {
      color = LEAD_COLOR
      op[k] = OP_FIXED
    } else {
      op[k] = OP_GLASS
      if (c.tint) {
        tinted[k] = 1
        tint.set(c.tint, k * 3)
      }
      if (c.paper) paper[k] = 1
    }
    if (color) fixed.set(color, k * 3)
  })

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      const k = codes[p] ?? 0
      const what = op[k]
      if (what === OP_OUT) {
        dst[i] = fr
        dst[i + 1] = fg
        dst[i + 2] = fb
        dst[i + 3] = 0
      } else if (what === OP_GRAIN) {
        const shift = (((y * 5 + Math.floor(x / 3)) % 7) - 3) * grain
        dst[i] = fr + shift
        dst[i + 1] = fg + shift
        dst[i + 2] = fb + shift
        dst[i + 3] = 255
      } else if (what === OP_FIXED) {
        dst[i] = fixed[k * 3] ?? 0
        dst[i + 1] = fixed[k * 3 + 1] ?? 0
        dst[i + 2] = fixed[k * 3 + 2] ?? 0
        dst[i + 3] = 255
      } else {
        let r = src[i] ?? 0
        let g = src[i + 1] ?? 0
        let b = src[i + 2] ?? 0
        let a = src[i + 3] ?? 0
        if (tinted[k] === 1) {
          r = (r + (tint[k * 3] ?? 0)) / 2
          g = (g + (tint[k * 3 + 1] ?? 0)) / 2
          b = (b + (tint[k * 3 + 2] ?? 0)) / 2
          a *= 0.92
        }
        if (paper[k] === 1) {
          r += (PAPER_COLOR[0] - r) * 0.7
          g += (PAPER_COLOR[1] - g) * 0.7
          b += (PAPER_COLOR[2] - b) * 0.7
          a *= 0.88
        }
        dst[i] = r
        dst[i + 1] = g
        dst[i + 2] = b
        dst[i + 3] = Math.round(a * opacity)
      }
    }
  }
  return out
}

/** The frame thickness a shape is classified with: material `none` has no outer frame. */
export const frameOf = (material: FrameMaterial, thickness: number): number =>
  material === 'none' ? 0 : thickness

/**
 * Cuts the picture into a window shape (see `paintWindow`). Thickness 0 or material `none`
 * drops the outer frame.
 */
export function applyWindow(
  picture: Raster,
  o: {
    shape: ShapeId
    glassOpacity: number
    material: FrameMaterial
    thickness: number
    pixelsPerBlock: number
    seed: number
  },
): Raster {
  const map = classifyShape(picture.width, picture.height, {
    shape: o.shape,
    frame: frameOf(o.material, o.thickness),
    pixelsPerBlock: o.pixelsPerBlock,
    seed: o.seed,
  })
  return paintWindow(picture, map, o)
}

/** How the painting looks without the mod: every pixel fully opaque. */
export function withoutMod(r: Raster): Raster {
  const out = cloneRaster(r)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  return out
}

/** Share of the painting that is see-through, 0..1. */
export function transparentShare(r: Raster): number {
  const pixels = r.width * r.height
  if (pixels === 0) return 0
  let sum = 0
  for (let i = 3; i < r.data.length; i += 4) sum += 1 - (r.data[i] ?? 0) / 255
  return sum / pixels
}
