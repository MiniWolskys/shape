import type { EditLayer } from './edits.ts'
import { createEditLayer } from './edits.ts'
import { getPixel, type PixelBox, type Raster, type RGBA } from './raster.ts'

/** Largest per-channel difference, alpha included. 0..255. */
export function colorDistance(a: RGBA, b: RGBA): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
    Math.abs(a[3] - b[3]),
  )
}

/**
 * Selects pixels within `tolerance` of the start pixel colour. Contiguous mode flood-fills
 * 4-way from the start (iterative); otherwise every matching pixel in the image is selected.
 */
export function selectSimilar(
  r: Raster,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const { width: w, height: h } = r
  const mask = new Uint8Array(w * h)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h) {
    return mask
  }
  const target = getPixel(r, x, y)
  const d = r.data
  // Inlined max-channel difference (same as colorDistance) to avoid a tuple allocation per pixel.
  const matches = (p: number): boolean => {
    const i = p * 4
    return (
      Math.max(
        Math.abs((d[i] ?? 0) - target[0]),
        Math.abs((d[i + 1] ?? 0) - target[1]),
        Math.abs((d[i + 2] ?? 0) - target[2]),
        Math.abs((d[i + 3] ?? 0) - target[3]),
      ) <= tolerance
    )
  }

  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (matches(p)) mask[p] = 1
    return mask
  }

  const stack = new Int32Array(w * h)
  let top = 0
  const start = y * w + x
  mask[start] = 1
  stack[top++] = start
  while (top > 0) {
    const p = stack[--top] as number
    const px = p % w
    const py = (p - px) / w
    if (px > 0 && mask[p - 1] === 0 && matches(p - 1)) {
      mask[p - 1] = 1
      stack[top++] = p - 1
    }
    if (px < w - 1 && mask[p + 1] === 0 && matches(p + 1)) {
      mask[p + 1] = 1
      stack[top++] = p + 1
    }
    if (py > 0 && mask[p - w] === 0 && matches(p - w)) {
      mask[p - w] = 1
      stack[top++] = p - w
    }
    if (py < h - 1 && mask[p + w] === 0 && matches(p + w)) {
      mask[p + w] = 1
      stack[top++] = p + w
    }
  }
  return mask
}

/** A fresh layer holding the same edits. */
export function copyLayer(layer: EditLayer): EditLayer {
  const out = createEditLayer(layer.values.width, layer.values.height)
  out.values.data.set(layer.values.data)
  out.mask.set(layer.mask)
  return out
}

function paintAt(layer: EditLayer, p: number, color: RGBA): void {
  layer.mask[p] = 1
  layer.values.data.set(color, p * 4)
}

/** Paints every masked pixel with `color`. Returns a new layer. */
export function paintMask(layer: EditLayer, mask: Uint8Array, color: RGBA): EditLayer {
  const out = copyLayer(layer)
  const n = Math.min(mask.length, out.mask.length)
  for (let p = 0; p < n; p++) if (mask[p] === 1) paintAt(out, p, color)
  return out
}

/**
 * Liang-Barsky clip to the box [lo, hiX] × [lo, hiY], rounded back to pixels so work is bounded
 * by size.
 */
function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: { lo: number; hiX: number; hiY: number },
): [number, number, number, number] | null {
  const dx = x1 - x0
  const dy = y1 - y0
  let t0 = 0
  let t1 = 1
  const edges: Array<[number, number]> = [
    [-dx, x0 - box.lo],
    [dx, box.hiX - x0],
    [-dy, y0 - box.lo],
    [dy, box.hiY - y0],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const t = q / p
      if (p < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [
    Math.round(x0 + t0 * dx),
    Math.round(y0 + t0 * dy),
    Math.round(x0 + t1 * dx),
    Math.round(y0 + t1 * dy),
  ]
}

function drawLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

/** Brush sizes, in painting pixels (square brushes). */
export const BRUSH_SIZES = [1, 2, 4, 8] as const

/**
 * The pixels a square brush of `size` covers when it is over pixel (x, y), inclusive: the pixel
 * and `floor(size / 2)` pixels before it on each axis (so 1 px is the pixel itself).
 */
export function brushFootprint(x: number, y: number, size: number): PixelBox {
  const before = Math.floor(size / 2)
  return { x0: x - before, y0: y - before, x1: x - before + size - 1, y1: y - before + size - 1 }
}

/**
 * The pixel a square brush of `size` is centred on for a pointer at `exact` (painting pixels,
 * fractional, along one axis): its square (see `brushFootprint`) starts at the pixel boundary
 * nearest `exact - size / 2`, so even brushes centre on the pixel corner nearest the pointer.
 * A 1 px brush is the pixel under the pointer.
 */
export function brushCentre(exact: number, size: number): number {
  return Math.round(exact - size / 2) + Math.floor(size / 2)
}

/** Draws Bresenham lines through consecutive points; out-of-bounds pixels are ignored. */
export function pencil(layer: EditLayer, points: Array<[number, number]>, color: RGBA): EditLayer {
  return pencilInto(copyLayer(layer), points, color)
}

/**
 * `pencil` with a square brush of `size` pixels (see `brushFootprint`), drawing into `out`
 * itself (a stroke's own working layer); returns `out`. The parts of the brush off the painting
 * are ignored, and so are lines whose brush never reaches it.
 */
export function pencilInto(
  out: EditLayer,
  points: Array<[number, number]>,
  color: RGBA,
  size = 1,
): EditLayer {
  const w = out.values.width
  const h = out.values.height
  const side = Math.max(1, Math.round(size))
  const before = Math.floor(side / 2)
  const after = side - 1 - before
  const plot = (x: number, y: number): void => {
    const x0 = Math.max(0, x - before)
    const x1 = Math.min(w - 1, x + after)
    const y0 = Math.max(0, y - before)
    const y1 = Math.min(h - 1, y + after)
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) paintAt(out, py * w + px, color)
    }
  }
  // Centres whose brush still touches the painting.
  const reach = { lo: -after, hiX: w - 1 + before, hiY: h - 1 + before }
  let prev: [number, number] | undefined
  for (const [px, py] of points) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue
    const x1 = Math.round(px)
    const y1 = Math.round(py)
    if (!prev) {
      plot(x1, y1)
    } else {
      const seg = clipSegment(prev[0], prev[1], x1, y1, reach)
      if (seg) drawLine(seg[0], seg[1], seg[2], seg[3], plot)
    }
    prev = [x1, y1]
  }
  return out
}

export function eyedropper(r: Raster, x: number, y: number): RGBA {
  const cx = Math.min(r.width - 1, Math.max(0, Math.floor(x)))
  const cy = Math.min(r.height - 1, Math.max(0, Math.floor(y)))
  return getPixel(r, cx, cy)
}

export function maskSize(mask: Uint8Array): number {
  let n = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++
  return n
}
