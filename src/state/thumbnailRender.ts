import type { Assets, Painting } from '../domain/types.ts'
import type { EditLayer } from '../imaging/edits.ts'
import { renderPainting } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import { resample } from '../imaging/resample.ts'
import { decodeEditLayer, decodePng } from '../packs/png.ts'

const MAX_PPB = 16

const own = (assets: Assets, id: string) => (Object.hasOwn(assets, id) ? assets[id] : undefined)

function decodeSource(p: Painting, assets: Assets): Raster | null {
  const source = p.recipe.source
  const bytes = source && own(assets, source.imageId)
  if (!bytes) return null
  try {
    return decodePng(bytes)
  } catch (error) {
    console.error(`Could not read the picture of ${p.id}`, error)
    return null
  }
}

function decodeEdits(p: Painting, assets: Assets): EditLayer | null {
  const id = p.recipe.editsId
  const values = id && own(assets, id)
  const mask = id && own(assets, `${id}.mask`)
  if (!values || !mask) return null
  try {
    return decodeEditLayer(values, mask)
  } catch (error) {
    console.error(`Could not read the edits of ${p.id}`, error)
    return null
  }
}

/** The assets a painting's thumbnail needs: its picture and edit layer. */
export function thumbnailAssets(p: Painting, assets: Assets): Assets {
  const ids = [
    p.recipe.source?.imageId,
    p.recipe.editsId,
    p.recipe.editsId && `${p.recipe.editsId}.mask`,
  ]
  const out: Assets = {}
  for (const id of ids) {
    const bytes = id ? own(assets, id) : undefined
    if (id && bytes) out[id] = bytes
  }
  return out
}

/**
 * The finished painting, scaled down (sharp) to at most 16 pixels per block. Runs in the image
 * worker; on the page only without workers.
 */
export function renderThumbnail(p: Painting, assets: Assets): Raster {
  const full = renderPainting(decodeSource(p, assets), decodeEdits(p, assets), p)
  if (p.pixelsPerBlock <= MAX_PPB) return full
  return resample(full, p.width * MAX_PPB, p.height * MAX_PPB, 'sharp')
}
