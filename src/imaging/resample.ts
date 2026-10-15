import { createRaster, type Raster } from './raster.ts'

/**
 * Resizes a raster. `sharp` is nearest-neighbour sampling at pixel centres;
 * `smooth` averages the source pixels whose centres fall in each target pixel's
 * footprint (at least the nearest one), weighting colour by alpha.
 */
export function resample(
  r: Raster,
  width: number,
  height: number,
  mode: 'sharp' | 'smooth',
): Raster {
  if (!(width >= 1) || !(height >= 1)) {
    throw new RangeError(`Cannot resample to ${width}x${height}`)
  }
  const out = createRaster(width, height)
  const src = r.data
  const dst = out.data
  const sw = r.width
  const sh = r.height
  const xScale = sw / width
  const yScale = sh / height

  if (mode === 'sharp') {
    for (let y = 0; y < height; y++) {
      const sy = Math.min(sh - 1, Math.floor((y + 0.5) * yScale))
      for (let x = 0; x < width; x++) {
        const sx = Math.min(sw - 1, Math.floor((x + 0.5) * xScale))
        const si = (sy * sw + sx) * 4
        const di = (y * width + x) * 4
        dst[di] = src[si] ?? 0
        dst[di + 1] = src[si + 1] ?? 0
        dst[di + 2] = src[si + 2] ?? 0
        dst[di + 3] = src[si + 3] ?? 0
      }
    }
    return out
  }

  const xr = footprints(sw, width)
  const yr = footprints(sh, height)
  for (let y = 0; y < height; y++) {
    const y0 = yr[y * 2] ?? 0
    const y1 = yr[y * 2 + 1] ?? 0
    for (let x = 0; x < width; x++) {
      const x0 = xr[x * 2] ?? 0
      const x1 = xr[x * 2 + 1] ?? 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let sumA = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        let si = (sy * sw + x0) * 4
        for (let sx = x0; sx < x1; sx++) {
          const a = src[si + 3] ?? 0
          sumR += (src[si] ?? 0) * a
          sumG += (src[si + 1] ?? 0) * a
          sumB += (src[si + 2] ?? 0) * a
          sumA += a
          count++
          si += 4
        }
      }
      const di = (y * width + x) * 4
      if (sumA > 0) {
        dst[di] = sumR / sumA
        dst[di + 1] = sumG / sumA
        dst[di + 2] = sumB / sumA
        dst[di + 3] = sumA / count
      }
    }
  }
  return out
}

/**
 * For each target index along one axis, the [start, end) source indices whose
 * centres fall inside its footprint. Never empty: falls back to the nearest pixel.
 */
function footprints(srcSize: number, dstSize: number): Int32Array {
  const scale = srcSize / dstSize
  const out = new Int32Array(dstSize * 2)
  for (let i = 0; i < dstSize; i++) {
    const lo = i * scale
    const hi = (i + 1) * scale
    let start = Math.max(0, Math.ceil(lo - 0.5))
    let end = Math.min(srcSize, Math.ceil(hi - 0.5))
    if (end <= start) {
      start = Math.min(srcSize - 1, Math.max(0, Math.floor((lo + hi) / 2)))
      end = start + 1
    }
    out[i * 2] = start
    out[i * 2 + 1] = end
  }
  return out
}
