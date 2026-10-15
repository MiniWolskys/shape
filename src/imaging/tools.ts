import type { EditLayer } from './edits.ts'
import { createEditLayer } from './edits.ts'
import { getPixel, type Raster, type RGBA } from './raster.ts'

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

function copyLayer(layer: EditLayer): EditLayer {
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

/** Draws Bresenham lines through consecutive points; out-of-bounds pixels are ignored. */
export function pencil(layer: EditLayer, points: Array<[number, number]>, color: RGBA): EditLayer {
  const out = copyLayer(layer)
  const w = out.values.width
  const h = out.values.height
  const plot = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < w && y < h) paintAt(out, y * w + x, color)
  }
  points.forEach(([px, py], idx) => {
    const x1 = Math.round(px)
    const y1 = Math.round(py)
    const prev = points[idx - 1]
    if (!prev) {
      plot(x1, y1)
      return
    }
    let x0 = Math.round(prev[0])
    let y0 = Math.round(prev[1])
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
  })
  return out
}

export function eyedropper(r: Raster, x: number, y: number): RGBA {
  return getPixel(r, x, y)
}

export function maskSize(mask: Uint8Array): number {
  let n = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++
  return n
}
