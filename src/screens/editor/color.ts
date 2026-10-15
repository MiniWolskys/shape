import { DYE_HEX, type DyeId, type FrameMaterial } from '../../domain/types.ts'
import { FRAME_MATERIALS } from '../../imaging/materials.ts'
import type { RGB, RGBA } from '../../imaging/raster.ts'

export interface HSV {
  /** 0..360 */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  v: number
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#RRGGBB` or `#RGB` (any case) to RGB; anything else is null. */
export function parseHex(text: string): RGB | null {
  const match = HEX.exec(text.trim())
  const digits = match?.[1]
  if (!digits) return null
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16)
  return [channel(0), channel(2), channel(4)]
}

export function toHex([r, g, b]: RGB | RGBA): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function rgbToHsv([r, g, b]: RGB | RGBA): HSV {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const d = max - Math.min(rn, gn, bn)
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d + 6) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
  }
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return [f(5), f(3), f(1)]
}

/** Alpha 0..255 as a whole percentage, and back. */
export const alphaToPercent = (alpha: number) => Math.round((alpha * 100) / 255)
export const percentToAlpha = (percent: number) =>
  Math.round((Math.min(100, Math.max(0, percent)) * 255) / 100)

export const sameColor = (a: RGBA, b: RGBA) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]

export const TRANSPARENT: RGBA = [0, 0, 0, 0]
export const GLASS_25: RGBA = [170, 210, 255, 64]
export const GLASS_50: RGBA = [170, 210, 255, 128]

/** The frame material colour, opaque (`none` falls back to dark oak like the pipeline). */
export function frameColor(material: FrameMaterial): RGBA {
  const [r, g, b] = FRAME_MATERIALS[material].color
  return [r, g, b, 255]
}

export function dyeColor(id: DyeId): RGBA {
  const [r, g, b] = parseHex(DYE_HEX[id]) ?? [0, 0, 0]
  return [r, g, b, 255]
}

/** A CSS colour for a swatch showing `c` (alpha included). */
export const cssColor = ([r, g, b, a]: RGBA) => `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`
