import type { Library, Painting } from '../domain/types.ts'
import { jsonBytes, PACK_FORMATS } from './formats.ts'

/** Data pack: pack.mcmeta, one painting variant per painting, and the placeable tag. */
export function buildDatapackFiles(
  lib: Library,
  paintings: Painting[],
): Record<string, Uint8Array> {
  const ns = lib.namespace
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': jsonBytes({
      pack: { description: `${lib.name} (Shape, data)`, ...PACK_FORMATS.data },
    }),
    'data/minecraft/tags/painting_variant/placeable.json': jsonBytes({
      replace: false,
      values: paintings.map((p) => `${ns}:${p.id}`),
    }),
  }
  for (const p of paintings) {
    files[`data/${ns}/painting_variant/${p.id}.json`] = jsonBytes({
      asset_id: `${ns}:${p.id}`,
      width: p.width,
      height: p.height,
      title: { text: p.title, color: p.titleColor },
      author: { text: p.author, color: p.authorColor },
    })
  }
  return files
}
