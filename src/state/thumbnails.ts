import { useEffect, useRef, useState } from 'react'
import type { Assets, Painting } from '../domain/types.ts'
import type { EditLayer } from '../imaging/edits.ts'
import { renderPainting } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import { resample } from '../imaging/resample.ts'
import { decodeEditLayer, decodePng } from '../packs/png.ts'
import { useWorkspace } from './workspace.ts'

const MAX_PPB = 16

/** Thumbnails by `${id}:${updatedAt}`; a newer render of a painting replaces the older one. */
const cache = new Map<string, Raster>()

const keyOf = (p: Painting) => `${p.id}:${p.updatedAt}`

function decodeSource(p: Painting, assets: Assets): Raster | null {
  const source = p.recipe.source
  const bytes = source && assets[source.imageId]
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
  const values = id && assets[id]
  const mask = id && assets[`${id}.mask`]
  if (!values || !mask) return null
  try {
    return decodeEditLayer(values, mask)
  } catch (error) {
    console.error(`Could not read the edits of ${p.id}`, error)
    return null
  }
}

/** The finished painting, scaled down (sharp) to at most 16 pixels per block. */
export function renderThumbnail(p: Painting, assets: Assets): Raster {
  const full = renderPainting(decodeSource(p, assets), decodeEdits(p, assets), p)
  if (p.pixelsPerBlock <= MAX_PPB) return full
  return resample(full, p.width * MAX_PPB, p.height * MAX_PPB, 'sharp')
}

/** Runs `task` when the browser is idle (or soon, without requestIdleCallback); returns a cancel. */
function whenIdle(task: () => void): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 1000 })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = setTimeout(task, 0)
  return () => clearTimeout(handle)
}

function store(p: Painting, raster: Raster) {
  const prefix = `${p.id}:`
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
  cache.set(keyOf(p), raster)
}

/**
 * The painting's thumbnail, or null while it is being rendered off the critical path.
 * Renders again only when `updatedAt` changes.
 */
export function useThumbnail(p: Painting): Raster | null {
  const key = keyOf(p)
  const latest = useRef(p)
  const [rendered, setRendered] = useState<{ key: string; raster: Raster } | null>(null)

  useEffect(() => {
    latest.current = p
  })

  useEffect(() => {
    if (cache.has(key)) return
    return whenIdle(() => {
      const painting = latest.current
      const raster = renderThumbnail(painting, useWorkspace.getState().assets)
      store(painting, raster)
      setRendered({ key, raster })
    })
  }, [key])

  return cache.get(key) ?? (rendered?.key === key ? rendered.raster : null)
}
