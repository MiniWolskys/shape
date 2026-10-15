import { cloneRaster, createRaster, type Raster } from './raster.ts'
import { resample } from './resample.ts'

/** Rotates clockwise. */
export function rotate(r: Raster, rotation: 0 | 90 | 180 | 270): Raster {
  if (rotation === 0) return cloneRaster(r)
  const { width: w, height: h, data: src } = r
  const swap = rotation !== 180
  const out = createRaster(swap ? h : w, swap ? w : h)
  const dst = out.data
  const ow = out.width
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < ow; x++) {
      let sx: number
      let sy: number
      if (rotation === 90) {
        sx = y
        sy = h - 1 - x
      } else if (rotation === 180) {
        sx = w - 1 - x
        sy = h - 1 - y
      } else {
        sx = w - 1 - y
        sy = x
      }
      const si = (sy * w + sx) * 4
      const di = (y * ow + x) * 4
      dst[di] = src[si] ?? 0
      dst[di + 1] = src[si + 1] ?? 0
      dst[di + 2] = src[si + 2] ?? 0
      dst[di + 3] = src[si + 3] ?? 0
    }
  }
  return out
}

export function flip(r: Raster, flipX: boolean, flipY: boolean): Raster {
  const { width: w, height: h, data: src } = r
  const out = createRaster(w, h)
  const dst = out.data
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y
    for (let x = 0; x < w; x++) {
      const sx = flipX ? w - 1 - x : x
      const si = (sy * w + sx) * 4
      const di = (y * w + x) * 4
      dst[di] = src[si] ?? 0
      dst[di + 1] = src[si + 1] ?? 0
      dst[di + 2] = src[si + 2] ?? 0
      dst[di + 3] = src[si + 3] ?? 0
    }
  }
  return out
}

/** Crops to the rect clamped to the raster bounds. Throws RangeError if nothing remains. */
export function crop(
  r: Raster,
  rect: { x: number; y: number; width: number; height: number },
): Raster {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(r.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(r.height, Math.floor(rect.y + rect.height))
  if (x1 <= x0 || y1 <= y0) throw new RangeError('Crop rectangle is outside the raster')
  const out = createRaster(x1 - x0, y1 - y0)
  const rowBytes = (x1 - x0) * 4
  for (let y = y0; y < y1; y++) {
    const start = (y * r.width + x0) * 4
    out.data.set(r.data.subarray(start, start + rowBytes), (y - y0) * rowBytes)
  }
  return out
}

/** Smooth downscale if the longest side exceeds maxSide; otherwise a copy. */
export function fitWithin(r: Raster, maxSide: number): Raster {
  const longest = Math.max(r.width, r.height)
  if (longest <= maxSide) return cloneRaster(r)
  const scale = maxSide / longest
  const w = Math.max(1, Math.round(r.width * scale))
  const h = Math.max(1, Math.round(r.height * scale))
  return resample(r, w, h, 'smooth')
}

/** Largest centred rectangle with the given aspect ratio inside the source. */
export function centeredCrop(
  srcW: number,
  srcH: number,
  ratioW: number,
  ratioH: number,
): { x: number; y: number; width: number; height: number } {
  let width: number
  let height: number
  if (srcW * ratioH >= srcH * ratioW) {
    height = srcH
    width = Math.min(srcW, Math.floor((srcH * ratioW) / ratioH))
  } else {
    width = srcW
    height = Math.min(srcH, Math.floor((srcW * ratioH) / ratioW))
  }
  return {
    x: Math.floor((srcW - width) / 2),
    y: Math.floor((srcH - height) / 2),
    width,
    height,
  }
}
