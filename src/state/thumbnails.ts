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

/** Runs `task` when the browser is idle, or soon without requestIdleCallback. */
function whenIdle(task: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 1000 })
  } else {
    setTimeout(task, 0)
  }
}

interface Job {
  run(): void
  cancelled: boolean
}

/** Thumbnails render one per idle slot, in request order; cancelled jobs are skipped. */
const queue: Job[] = []
let pumping = false

function pump() {
  pumping = true
  whenIdle(() => {
    let job = queue.shift()
    while (job?.cancelled) job = queue.shift()
    job?.run()
    if (queue.some((j) => !j.cancelled)) pump()
    else {
      queue.length = 0
      pumping = false
    }
  })
}

function enqueue(run: () => void): () => void {
  const job: Job = { run, cancelled: false }
  queue.push(job)
  if (!pumping) pump()
  return () => {
    job.cancelled = true
  }
}

export const THUMBNAIL_CACHE_SIZE = 200

/** Number of thumbnails kept in memory. */
export function thumbnailCacheSize(): number {
  return cache.size
}

/** Reads a thumbnail and marks it as most recently used. */
function cached(key: string): Raster | undefined {
  const raster = cache.get(key)
  if (raster) {
    cache.delete(key)
    cache.set(key, raster)
  }
  return raster
}

function store(p: Painting, raster: Raster) {
  const prefix = `${p.id}:`
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
  cache.set(keyOf(p), raster)
  // Maps keep insertion order, so the first key is the least recently used.
  while (cache.size > THUMBNAIL_CACHE_SIZE) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

export type Thumbnail = Raster | 'failed' | null

/**
 * The painting's thumbnail; null while it waits for its idle render, 'failed' if rendering
 * threw. Renders again only when `updatedAt` changes.
 */
export function useThumbnail(p: Painting): Thumbnail {
  const key = keyOf(p)
  const latest = useRef(p)
  const [rendered, setRendered] = useState<{ key: string; result: Raster | 'failed' } | null>(null)

  useEffect(() => {
    latest.current = p
  })

  useEffect(() => {
    if (cache.has(key)) return
    return enqueue(() => {
      const painting = latest.current
      try {
        const raster = renderThumbnail(painting, useWorkspace.getState().assets)
        store(painting, raster)
        setRendered({ key, result: raster })
      } catch (error) {
        console.error(`Could not render the thumbnail of ${painting.id}`, error)
        setRendered({ key, result: 'failed' })
      }
    })
  }, [key])

  return cached(key) ?? (rendered?.key === key ? rendered.result : null)
}
