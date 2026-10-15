import { useDeferredValue, useMemo } from 'react'
import type { EditLayer } from '../imaging/edits.ts'
import { renderPainting, type TextureSpec } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import { transparentShare, withoutMod } from '../imaging/window.ts'
import { useEditor } from './editor.ts'

export interface RenderedPainting {
  raster: Raster | null
  withoutMod: Raster | null
  /** Share of see-through pixels, 0..1. */
  transparent: number
}

/**
 * The last render, shared by every caller: the stage, the inspector previews and the pixel
 * tools all read the same raster instead of each rendering their own. Inputs compare by
 * identity, and only the fields that reach the texture count (a new title is a cache hit).
 */
let last: {
  spec: TextureSpec
  source: Raster | null
  edits: EditLayer | null
  raster: Raster
} | null = null

function renderShared(spec: TextureSpec, source: Raster | null, edits: EditLayer | null): Raster {
  const s = last?.spec
  if (
    last &&
    s &&
    last.source === source &&
    last.edits === edits &&
    s.id === spec.id &&
    s.recipe === spec.recipe &&
    s.width === spec.width &&
    s.height === spec.height &&
    s.pixelsPerBlock === spec.pixelsPerBlock
  ) {
    return last.raster
  }
  const raster = renderPainting(source, edits, spec)
  last = { spec, source, edits, raster }
  return raster
}

/** Views derived from a render, shared like the render itself. */
const derived = new WeakMap<Raster, RenderedPainting>()

function derive(raster: Raster | null): RenderedPainting {
  if (!raster) return EMPTY
  let out = derived.get(raster)
  if (!out) {
    out = { raster, withoutMod: withoutMod(raster), transparent: transparentShare(raster) }
    derived.set(raster, out)
  }
  return out
}

const EMPTY: RenderedPainting = { raster: null, withoutMod: null, transparent: 0 }

/**
 * The editor's painting as it is right now (not deferred): what the pixel tools pick from, so
 * the wand and the eyedropper see exactly what was last committed.
 */
export function currentRaster(): Raster | null {
  const { painting, source, edits } = useEditor.getState()
  if (!painting) return null
  return renderShared(painting, source, edits)
}

/**
 * The editor's painting, rendered. Inputs are deferred so a slider drag commits first and the
 * render follows in a later, interruptible render; the pipeline only reruns when the recipe,
 * size, picture or edits change (a new title does not re-render the texture).
 */
export function useRenderedPainting(): RenderedPainting {
  const painting = useDeferredValue(useEditor((s) => s.painting))
  const source = useDeferredValue(useEditor((s) => s.source))
  const edits = useDeferredValue(useEditor((s) => s.edits))

  // Only these fields reach the texture, so a new title does not re-render it.
  const { id, recipe, width, height, pixelsPerBlock } = painting ?? {}
  const raster = useMemo(() => {
    if (id === undefined || !recipe || !width || !height || !pixelsPerBlock) return null
    try {
      return renderShared({ id, recipe, width, height, pixelsPerBlock }, source, edits)
    } catch (error) {
      console.error('Could not render the painting', error)
      return null
    }
  }, [id, recipe, width, height, pixelsPerBlock, source, edits])

  return useMemo(() => derive(raster), [raster])
}
