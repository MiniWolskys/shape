import type { FrameMaterial, Painting } from '../domain/types.ts'
import { adjust } from './adjust.ts'
import { applyEdits, isEmptyLayer, resampleEdits, type EditLayer } from './edits.ts'
import { FRAME_MATERIALS } from './materials.ts'
import { quantize } from './quantize.ts'
import { cloneRaster, createRaster, type Raster, type RGBA } from './raster.ts'
import { resample } from './resample.ts'
import { hashString } from './shapes.ts'
import { centeredCrop, crop, flip, rotate } from './transform.ts'
import { createShapeCache, type Task } from './shapeCache.ts'
import { frameOf, paintWindow, type ShapeOptions } from './window.ts'

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

/**
 * The stages of the pipeline, in order. Each one is kept with the inputs it was made from, so a
 * change only redoes the stages it reaches: glass, frame and shape start again from the looked
 * picture, new edits from the windowed one.
 */
export type Stage = 'turned' | 'sized' | 'adjusted' | 'looked' | 'shaped' | 'windowed' | 'edited'

/** One remembered result, reused while every part of its key is identical (Object.is). */
function slot<T>(onCompute: () => void) {
  let key: readonly unknown[] | null = null
  let value: T | null = null
  return {
    get(next: readonly unknown[], compute: () => T): T {
      const last = key
      const same =
        last !== null && last.length === next.length && last.every((k, i) => Object.is(k, next[i]))
      if (same && value !== null) return value
      key = null
      value = compute()
      key = next
      onCompute()
      return value
    },
    clear() {
      key = null
      value = null
    },
  }
}

export interface StagedRenderer {
  /** Same result as `renderPainting`, as a fresh raster the caller owns. */
  render(source: Raster | null, edits: EditLayer | null, p: TextureSpec): Raster
  /** Same result as `renderPicture`, but shared with the cache: never mutate it. */
  picture(source: Raster | null, p: TextureSpec): Raster
  /**
   * Background work that makes likely next changes of this painting fast (other shapes, other
   * frame thicknesses); run it a step at a time while nothing else is waiting.
   */
  prefetch(p: TextureSpec): Task
  /** How many times each stage was computed (for tests and measurements). */
  readonly computed: Readonly<Record<Stage, number>>
  /** Forgets every remembered stage. */
  clear(): void
}

/**
 * A renderer that remembers the last result of each stage (and the window shapes it classified,
 * see createShapeCache). Inputs compare by identity (source
 * raster, edit layer) or by value (recipe fields), and stage results are never mutated, so a
 * remembered stage is always exactly what computing it again would give.
 */
export function createStagedRenderer(): StagedRenderer {
  const computed: Record<Stage, number> = {
    turned: 0,
    sized: 0,
    adjusted: 0,
    looked: 0,
    shaped: 0,
    windowed: 0,
    edited: 0,
  }
  const stage = (name: Stage) =>
    slot<Raster>(() => {
      computed[name]++
    })
  const turned = stage('turned')
  const sized = stage('sized')
  const adjusted = stage('adjusted')
  const looked = stage('looked')
  const windowed = stage('windowed')
  const edited = stage('edited')
  const shapes = createShapeCache(() => {
    computed.shaped++
  })

  const shapeOptions = (p: TextureSpec): ShapeOptions => ({
    shape: p.recipe.window.shape,
    frame: frameOf(p.recipe.frame.material, p.recipe.frame.thickness),
    pixelsPerBlock: p.pixelsPerBlock,
    seed: hashString(p.id),
  })

  function resized(source: Raster | null, p: TextureSpec): Raster {
    const { recipe } = p
    const width = p.width * p.pixelsPerBlock
    const height = p.height * p.pixelsPerBlock
    if (!source) {
      return sized.get([null, width, height, p.pixelsPerBlock], () =>
        placeholder(width, height, p.pixelsPerBlock),
      )
    }
    const { rotation, flipX, flipY } = recipe
    const t = turned.get([source, rotation, flipX, flipY], () =>
      // Unturned, the source itself is the turned picture: stages are never mutated.
      rotation === 0 && !flipX && !flipY ? source : flip(rotate(source, rotation), flipX, flipY),
    )
    const { x, y, width: cw, height: ch } = recipe.crop
    return sized.get([t, x, y, cw, ch, p.width, p.height, width, height, recipe.scaling], () => {
      // An unset crop, or one left stale by a rotation or a new source, falls back to the centre.
      const fits = cw > 0 && ch > 0 && x >= 0 && y >= 0 && x + cw <= t.width && y + ch <= t.height
      const rect = fits ? recipe.crop : centeredCrop(t.width, t.height, p.width, p.height)
      return resample(crop(t, rect), width, height, recipe.scaling)
    })
  }

  function picture(source: Raster | null, p: TextureSpec): Raster {
    const pic = resized(source, p)
    // The placeholder is shown as it is: adjustments and the look are for the player's picture.
    if (!source) return pic
    const a = p.recipe.adjust
    const plain = a.brightness === 0 && a.contrast === 0 && a.saturation === 0
    const withAdjust = adjusted.get([pic, a.brightness, a.contrast, a.saturation], () =>
      plain ? pic : adjust(pic, a),
    )
    const look = p.recipe.mcLook
    return looked.get([withAdjust, look.enabled, look.colors, look.palette, look.dither], () =>
      look.enabled ? quantize(withAdjust, look) : withAdjust,
    )
  }

  function render(source: Raster | null, edits: EditLayer | null, p: TextureSpec): Raster {
    const pic = picture(source, p)
    const { glassOpacity } = p.recipe.window
    const { material } = p.recipe.frame
    const map = shapes.get(pic.width, pic.height, shapeOptions(p))
    const shaped = windowed.get([pic, map, glassOpacity, material], () =>
      paintWindow(pic, map, { glassOpacity, material }),
    )
    const withEdits = edited.get([shaped, edits], () => {
      if (!edits || isEmptyLayer(edits)) return shaped
      const fitted =
        edits.values.width === shaped.width && edits.values.height === shaped.height
          ? edits
          : resampleEdits(edits, shaped.width, shaped.height)
      return applyEdits(shaped, fitted)
    })
    return seeThroughToFrame(cloneRaster(withEdits), material)
  }

  return {
    render,
    picture,
    prefetch: (p) =>
      shapes.prefetch(p.width * p.pixelsPerBlock, p.height * p.pixelsPerBlock, shapeOptions(p)),
    computed,
    clear() {
      for (const s of [turned, sized, adjusted, looked, windowed, edited]) s.clear()
      shapes.clear()
    },
  }
}

/** The picture at the painting's pixel size, before the window shape is applied. */
export function renderPicture(source: Raster | null, p: TextureSpec): Raster {
  return createStagedRenderer().picture(source, p)
}

/** The finished painting texture: picture, window shape and frame, then hand edits. */
export function renderPainting(
  source: Raster | null,
  edits: EditLayer | null,
  p: TextureSpec,
): Raster {
  return createStagedRenderer().render(source, edits, p)
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
