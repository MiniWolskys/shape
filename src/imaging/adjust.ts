import { cloneRaster, type Raster } from './raster.ts'

/** Brightness, contrast and saturation, each -100..100; alpha is untouched. */
export function adjust(
  r: Raster,
  a: { brightness: number; contrast: number; saturation: number },
): Raster {
  const out = cloneRaster(r)
  const add = a.brightness * 2.55
  const c = a.contrast * 2.55
  const factor = (259 * (c + 255)) / (255 * (259 - c))
  const sat = 1 + a.saturation / 100
  const doAdd = a.brightness !== 0
  const doContrast = a.contrast !== 0
  const doSat = a.saturation !== 0
  if (!doAdd && !doContrast && !doSat) return out
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    let red = d[i] ?? 0
    let green = d[i + 1] ?? 0
    let blue = d[i + 2] ?? 0
    if (doAdd) {
      red = clamp(red + add)
      green = clamp(green + add)
      blue = clamp(blue + add)
    }
    if (doContrast) {
      red = clamp(factor * (red - 128) + 128)
      green = clamp(factor * (green - 128) + 128)
      blue = clamp(factor * (blue - 128) + 128)
    }
    if (doSat) {
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      red = clamp(luma + (red - luma) * sat)
      green = clamp(luma + (green - luma) * sat)
      blue = clamp(luma + (blue - luma) * sat)
    }
    d[i] = red
    d[i + 1] = green
    d[i + 2] = blue
  }
  return out
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
