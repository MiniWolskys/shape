import type { ShapeId } from '../domain/types.ts'
import type { RGB } from './raster.ts'

export type PixelKind = 'out' | 'frame' | 'lead' | 'glass'

/** What a pixel of a window shape is. Results may be shared: never mutate them. */
export interface Classified {
  kind: PixelKind
  tint?: RGB
  paper?: boolean
  light?: boolean
  rivet?: boolean
}

export interface ShapeContext {
  width: number
  height: number
  /**
   * Frame thickness in pixels (0 = no frame): the outer frame, and the wooden bars inside
   * (fanlight spokes and hub, four-pane cross, paper-screen grid), which disappear at 0.
   */
  frame: number
  /** Width of interior lead lines in pixels: the shape's own, whatever the frame. */
  lead: number
  pixelsPerBlock: number
  /** Stained-glass cell centres. */
  cells: Array<[number, number]>
}

/** Seeded PRNG returning values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit hash of the string's UTF-16 code units. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function makeShapeContext(
  width: number,
  height: number,
  pixelsPerBlock: number,
  frameThickness: number,
  seed: number,
): ShapeContext {
  const random = mulberry32(seed)
  const count = Math.max(6, Math.round((width / pixelsPerBlock) * (height / pixelsPerBlock) * 5))
  const cells: Array<[number, number]> = []
  for (let i = 0; i < count; i++) cells.push([random() * width, random() * height])
  return {
    width,
    height,
    frame: Math.max(0, frameThickness),
    lead: Math.max(2, Math.round(pixelsPerBlock / 8)),
    pixelsPerBlock,
    cells,
  }
}

const OUT: Classified = { kind: 'out' }
const FRAME: Classified = { kind: 'frame' }
const LEAD: Classified = { kind: 'lead' }
const GLASS: Classified = { kind: 'glass' }
const LIGHT_FRAME: Classified = { kind: 'frame', light: true }
const RIVET: Classified = { kind: 'frame', rivet: true }
const PAPER: Classified = { kind: 'glass', paper: true }

const TINTS: readonly RGB[] = [
  [200, 50, 70],
  [50, 100, 210],
  [240, 170, 50],
  [40, 160, 100],
  [130, 70, 190],
]
const TINTED: readonly Classified[] = TINTS.map((tint) => ({ kind: 'glass', tint }))
const tinted = (i: number): Classified => TINTED[i % TINTED.length] ?? GLASS

/**
 * `inside(i)` says whether the point lies inside the shape inset by `i` pixels. Outside the
 * shape is `out`; within `f` pixels of its edge is the frame; deeper is glass.
 */
function band(inside: (inset: number) => boolean, f: number): Classified {
  if (!inside(0)) return OUT
  return f <= 0 || inside(f) ? GLASS : FRAME
}

const rectIn = (x: number, y: number, w: number, h: number) => (i: number) =>
  x >= i && x <= w - i && y >= i && y <= h - i

/** Euclidean length; much faster than Math.hypot in the per-pixel loops. */
const dist = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy)

/** Angular distance (radians) from `a` to the nearest multiple of `seg`. */
function toSpoke(a: number, seg: number): number {
  const da = ((a % seg) + seg) % seg
  return Math.min(da, seg - da)
}

type ShapeFn = (x: number, y: number, ctx: ShapeContext) => Classified

const oculus: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r = Math.min(w, h) / 2
  const d = dist(x - w / 2, y - h / 2)
  return band((i) => d <= r - i, frame)
}

const roundArch: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r = w / 2
  return band(
    (i) => x >= i && x <= w - i && y <= h - i && (y >= r || dist(x - r, y - r) <= r - i),
    frame,
  )
}

const gothicArch: ShapeFn = (x, y, { width: w, height: h, frame, lead }) => {
  const h0 = w * 0.866
  const c = band(
    (i) =>
      x >= i &&
      x <= w - i &&
      y <= h - i &&
      (y >= h0 || (dist(x, y - h0) <= w - i && dist(x - w, y - h0) <= w - i)),
    frame,
  )
  return c === GLASS && Math.abs(x - w / 2) < lead / 2 && y > h0 * 0.55 ? LEAD : c
}

const rose: ShapeFn = (x, y, { width: w, height: h, frame, lead }) => {
  const r = Math.min(w, h) / 2
  const dx = x - w / 2
  const dy = y - h / 2
  const d = dist(dx, dy)
  const c = band((i) => d <= r - i, frame)
  if (c !== GLASS) return c
  const hub = r * 0.28
  if (Math.abs(d - hub) < lead / 2 || Math.abs(d - r * 0.64) < lead / 2) return LEAD
  const seg = (Math.PI * 2) / 12
  const a = Math.atan2(dy, dx) + Math.PI
  if (d > hub && toSpoke(a, seg) * d < lead / 2) return LEAD
  return tinted(d < hub ? 2 : (Math.floor(a / seg) + (d > r * 0.64 ? 1 : 0)) % 4)
}

interface CellGrid {
  size: number
  cols: number
  rows: number
  /** Cells of bucket k are entries starts[k]..starts[k + 1] of xs, ys and ids. */
  starts: Int32Array
  xs: Float64Array
  ys: Float64Array
  ids: Int32Array
}

const grids = new WeakMap<ShapeContext, CellGrid>()

/** Buckets the stained-glass cells (about one per bucket) so nearest searches stay local. */
function cellGrid(ctx: ShapeContext): CellGrid {
  const cached = grids.get(ctx)
  if (cached) return cached
  const n = ctx.cells.length
  const size = Math.max(1, Math.sqrt((ctx.width * ctx.height) / Math.max(1, n)))
  const cols = Math.max(1, Math.ceil(ctx.width / size))
  const rows = Math.max(1, Math.ceil(ctx.height / size))
  const bucketOf = ([cx, cy]: [number, number]) =>
    Math.min(rows - 1, Math.max(0, Math.floor(cy / size))) * cols +
    Math.min(cols - 1, Math.max(0, Math.floor(cx / size)))
  const starts = new Int32Array(cols * rows + 1)
  for (const cell of ctx.cells) {
    const k = bucketOf(cell) + 1
    starts[k] = (starts[k] ?? 0) + 1
  }
  for (let k = 0; k < cols * rows; k++) starts[k + 1] = (starts[k + 1] ?? 0) + (starts[k] ?? 0)
  const fill = starts.slice(0, cols * rows)
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const ids = new Int32Array(n)
  ctx.cells.forEach((cell, j) => {
    const k = bucketOf(cell)
    const at = fill[k] ?? 0
    fill[k] = at + 1
    xs[at] = cell[0]
    ys[at] = cell[1]
    ids[at] = j
  })
  const grid = { size, cols, rows, starts, xs, ys, ids }
  grids.set(ctx, grid)
  return grid
}

const stainedGlass: ShapeFn = (x, y, ctx) => {
  const c = band(rectIn(x, y, ctx.width, ctx.height), ctx.frame)
  if (c !== GLASS) return c
  const { size, cols, rows, starts, xs, ys, ids } = cellGrid(ctx)
  const bx = Math.min(cols - 1, Math.max(0, Math.floor(x / size)))
  const by = Math.min(rows - 1, Math.max(0, Math.floor(y / size)))
  // Squared distances to the nearest and second-nearest cell centres.
  let q1 = Infinity
  let q2 = Infinity
  let id = 0
  const maxRing = Math.max(cols, rows)
  for (let k = 0; k <= maxRing; k++) {
    for (let gy = by - k; gy <= by + k; gy++) {
      if (gy < 0 || gy >= rows) continue
      const step = k === 0 || gy === by - k || gy === by + k ? 1 : 2 * k
      for (let gx = bx - k; gx <= bx + k; gx += step) {
        if (gx < 0 || gx >= cols) continue
        const bucket = gy * cols + gx
        const end = starts[bucket + 1] ?? 0
        for (let e = starts[bucket] ?? 0; e < end; e++) {
          const dx = x - (xs[e] ?? 0)
          const dy = y - (ys[e] ?? 0)
          const q = dx * dx + dy * dy
          const j = ids[e] ?? 0
          if (q < q1 || (q === q1 && j < id)) {
            q2 = q1
            q1 = q
            id = j
          } else if (q < q2) q2 = q
        }
      }
    }
    // Every cell in a ring beyond k is at least k * size away.
    const reach = k * size
    if (q2 <= reach * reach) break
  }
  return Math.sqrt(q2) - Math.sqrt(q1) < ctx.lead * 0.75 ? LEAD : tinted(id)
}

/** Whether pixel `i` is in the `t` pixels wide bar centred on `size / 2`. */
function midBar(i: number, size: number, t: number): boolean {
  const from = Math.round(size / 2 - t / 2)
  return i >= from && i < from + t
}

const fourPanes: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const c = band(rectIn(x, y, w, h), frame)
  return c === GLASS && (midBar(Math.floor(x), w, frame) || midBar(Math.floor(y), h, frame))
    ? FRAME
    : c
}

/** Spacing of the lattice and shoji grids: half a block, at least two pixels. */
const gridStep = (ppb: number) => Math.max(2, ppb / 2)

const leadedDiamonds: ShapeFn = (x, y, { width: w, height: h, frame, lead, pixelsPerBlock }) => {
  const c = band(rectIn(x, y, w, h), frame)
  if (c !== GLASS) return c
  const s = gridStep(pixelsPerBlock)
  const lw = Math.max(1, lead / 3)
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  return (xi + yi) % s < lw || (((xi - yi) % s) + s) % s < lw ? LEAD : GLASS
}

const LOBES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const quatrefoil: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r = Math.min(w, h) / 4
  const cx = w / 2
  const cy = h / 2
  return band(
    (i) =>
      LOBES.some(([ox, oy]) => dist(x - cx - ox * r, y - cy - oy * r) <= r - i) ||
      (Math.abs(x - cx) <= r * 0.8 - i && Math.abs(y - cy) <= r * 0.8 - i),
    frame,
  )
}

const octagon: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r = Math.min(w, h) / 2
  const dx = Math.abs(x - w / 2)
  const dy = Math.abs(y - h / 2)
  const m = Math.max(dx, dy, (dx + dy) * 0.7071 * 1.0824)
  return band((i) => m <= r - i, frame)
}

const fanlight: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r0 = Math.min(w / 2, h)
  const dx = x - w / 2
  const dy = h - y
  const d = dist(dx, dy)
  const c = band((i) => y <= h - i && d <= r0 - i, frame)
  // The hub and spokes are wood like the frame: without a frame, it is all glass.
  if (c !== GLASS || frame <= 0) return c
  if (d < r0 * 0.28) return FRAME
  // Distance across to the nearest spoke, so a spoke is exactly `frame` pixels wide.
  return Math.sin(toSpoke(Math.atan2(dy, dx), Math.PI / 7)) * d < frame / 2 ? FRAME : GLASS
}

const paperScreen: ShapeFn = (x, y, { width: w, height: h, frame, pixelsPerBlock }) => {
  const c = band(rectIn(x, y, w, h), frame)
  if (c !== GLASS) return c
  // The grid bars are as wide as the frame (none without one).
  const s = gridStep(pixelsPerBlock)
  return Math.floor(x) % s < frame || Math.floor(y) % s < frame ? LIGHT_FRAME : PAPER
}

const porthole: ShapeFn = (x, y, { width: w, height: h, frame }) => {
  const r = Math.min(w, h) / 2
  const dx = x - w / 2
  const dy = y - h / 2
  const d = dist(dx, dy)
  const c = band((i) => d <= r - i, frame * 2)
  if (
    c === FRAME &&
    Math.abs(d - (r - frame)) < frame * 0.45 &&
    toSpoke(Math.atan2(dy, dx), Math.PI / 4) * d < frame * 0.5
  ) {
    return RIVET
  }
  return c
}

const full: ShapeFn = (x, y, { width: w, height: h, frame }) => band(rectIn(x, y, w, h), frame)

/** Classifies the pixel centred at (x, y) — pass `i + 0.5` — for each window shape. */
export const SHAPES: Record<ShapeId, ShapeFn> = {
  full,
  oculus,
  round_arch: roundArch,
  gothic_arch: gothicArch,
  rose,
  stained_glass: stainedGlass,
  four_panes: fourPanes,
  leaded_diamonds: leadedDiamonds,
  quatrefoil,
  octagon,
  fanlight,
  paper_screen: paperScreen,
  porthole,
}
