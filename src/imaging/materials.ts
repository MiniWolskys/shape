import type { FrameMaterial } from '../domain/types.ts'
import type { RGB } from './raster.ts'

/** Frame colours; `grain` scales the deterministic wood/stone grain applied to frame pixels. */
export const FRAME_MATERIALS: Record<FrameMaterial, { color: RGB; grain: number }> = {
  oak: { color: [160, 120, 72], grain: 3 },
  spruce: { color: [112, 80, 48], grain: 3 },
  dark_oak: { color: [74, 47, 28], grain: 3 },
  birch: { color: [200, 182, 128], grain: 2 },
  gilded: { color: [208, 164, 58], grain: 4 },
  stone: { color: [126, 126, 128], grain: 5 },
  iron: { color: [196, 198, 202], grain: 2 },
  none: { color: [74, 47, 28], grain: 0 },
}

export const LEAD_COLOR: RGB = [42, 40, 46]

/** Relative luminance 0..1 of the material colour, without sRGB linearisation. */
export function frameLuminance(m: FrameMaterial): number {
  const [r, g, b] = FRAME_MATERIALS[m].color
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
