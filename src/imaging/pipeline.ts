import type { FrameMaterial, Painting } from '../domain/types.ts'
import { adjust } from './adjust.ts'
import { applyEdits, isEmptyLayer, resampleEdits, type EditLayer } from './edits.ts'
import { FRAME_MATERIALS } from './materials.ts'
import { quantize } from './quantize.ts'
import { createRaster, type Raster, type RGBA } from './raster.ts'
import { resample } from './resample.ts'
import { hashString } from './shapes.ts'
import { centeredCrop, crop, flip, rotate } from './transform.ts'
import { applyWindow } from './window.ts'

/** The painting fields that shape its texture; titles and status play no part. */
export type TextureSpec = Pick<Painting, 'id' | 'width' | 'height' | 'pixelsPerBlock' | 'recipe'>

const PLACEHOLDER_A: RGBA = [110, 110, 114, 255]
const PLACEHOLDER_B: RGBA = [92, 92, 96, 255]

/** Two-tone grey checker of quarter-block cells, shown until a picture is chosen. */
function placeholder(width: number, height: number, pixelsPerBlock: number): Raster {
  const cell = Math.max(1, Math.round(pixelsPerBlock / 4))
  const out = createRaster(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c =
        (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? PLACEHOLDER_A : PLACEHOLDER_B
      out.data.set(c, (y * width + x) * 4)
    }
  }
  return out
}

/** The picture at the painting's pixel size, before the window shape is applied. */
export function renderPicture(source: Raster | null, p: TextureSpec): Raster {
  const width = p.width * p.pixelsPerBlock
  const height = p.height * p.pixelsPerBlock
  if (!source) return placeholder(width, height, p.pixelsPerBlock)
  const { recipe } = p
  const turned = flip(rotate(source, recipe.rotation), recipe.flipX, recipe.flipY)
  const { x, y, width: cw, height: ch } = recipe.crop
  // An unset crop, or one left stale by a rotation or a new source, falls back to the centre.
  const fits =
    cw > 0 && ch > 0 && x >= 0 && y >= 0 && x + cw <= turned.width && y + ch <= turned.height
  const rect = fits ? recipe.crop : centeredCrop(turned.width, turned.height, p.width, p.height)
  const sized = resample(crop(turned, rect), width, height, recipe.scaling)
  const adjusted = adjust(sized, recipe.adjust)
  return recipe.mcLook.enabled ? quantize(adjusted, recipe.mcLook) : adjusted
}

/** The finished painting texture: picture, window shape and frame, then hand edits. */
export function renderPainting(
  source: Raster | null,
  edits: EditLayer | null,
  p: TextureSpec,
): Raster {
  const { recipe } = p
  const shaped = applyWindow(renderPicture(source, p), {
    shape: recipe.window.shape,
    glassOpacity: recipe.window.glassOpacity,
    material: recipe.frame.material,
    thickness: recipe.frame.thickness,
    pixelsPerBlock: p.pixelsPerBlock,
    seed: hashString(p.id),
  })
  if (!edits || isEmptyLayer(edits)) return seeThroughToFrame(shaped, recipe.frame.material)
  const sized =
    edits.values.width === shaped.width && edits.values.height === shaped.height
      ? edits
      : resampleEdits(edits, shaped.width, shaped.height)
  return seeThroughToFrame(applyEdits(shaped, sized), recipe.frame.material)
}

/**
 * R12: every fully transparent pixel, however it got there (shape cut, edit, eraser or the
 * picture itself), carries the frame colour, so players without the mod see the frame there.
 * Mutates `r`, which is always a fresh raster here.
 */
function seeThroughToFrame(r: Raster, material: FrameMaterial): Raster {
  const [fr, fg, fb] = FRAME_MATERIALS[material].color
  const d = r.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 0) continue
    d[i] = fr
    d[i + 1] = fg
    d[i + 2] = fb
  }
  return r
}
