import type { Library } from '../domain/types.ts'
import { jsonBytes, PACK_FORMATS } from './formats.ts'

/** Resource pack: pack.mcmeta and one painting texture (PNG bytes) per painting id. */
export function buildResourcePackFiles(
  lib: Library,
  textures: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': jsonBytes({
      pack: { description: `${lib.name} (Shape, textures)`, ...PACK_FORMATS.resources },
    }),
  }
  for (const [id, png] of Object.entries(textures)) {
    files[`assets/${lib.namespace}/textures/painting/${id}.png`] = png
  }
  return files
}
