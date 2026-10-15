import type { FrameMaterial } from '../domain/types.ts'
import { frameLuminance } from '../imaging/materials.ts'

export type BackdropKind = 'light' | 'dark' | 'mid' | 'sky'

/** Ruling R2: dark frames (and no frame) sit on a light backdrop, light frames on a dark one. */
export function autoBackdrop(m: FrameMaterial): 'light' | 'dark' {
  return m === 'none' || frameLuminance(m) < 0.45 ? 'light' : 'dark'
}
