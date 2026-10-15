import { useDeferredValue, useMemo } from 'react'
import { renderPainting } from '../imaging/pipeline.ts'
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
      return renderPainting(source, edits, { id, recipe, width, height, pixelsPerBlock })
    } catch (error) {
      console.error('Could not render the painting', error)
      return null
    }
  }, [id, recipe, width, height, pixelsPerBlock, source, edits])

  return useMemo(
    () => ({
      raster,
      withoutMod: raster && withoutMod(raster),
      transparent: raster ? transparentShare(raster) : 0,
    }),
    [raster],
  )
}
