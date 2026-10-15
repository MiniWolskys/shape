import { useEffect, useRef, useState } from 'react'
import type { Painting } from '../domain/types.ts'
import type { Raster } from '../imaging/raster.ts'
import { requestThumbnail } from '../workers/imageClient.ts'
import { useWorkspace } from './workspace.ts'

export { renderThumbnail } from './thumbnailRender.ts'

/** Thumbnails by `${id}:${updatedAt}`; a newer render of a painting replaces the older one. */
const cache = new Map<string, Raster>()

const keyOf = (p: Painting) => `${p.id}:${p.updatedAt}`

/** Runs `task` when the browser is idle, or soon without requestIdleCallback. */
function whenIdle(task: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 1000 })
  } else {
    setTimeout(task, 0)
  }
}

interface Job {
  /** Starts the job; it calls `done` when finished (at once when it runs on the page). */
  run(done: () => void): void
  cancelled: boolean
}

/**
 * Thumbnails render one at a time, each starting in an idle slot, in request order; cancelled
 * jobs are skipped. They render in the image worker (R39), on the page only without workers.
 */
const queue: Job[] = []
let pumping = false

function pump() {
  pumping = true
  whenIdle(() => {
    let job = queue.shift()
    while (job?.cancelled) job = queue.shift()
    const next = () => {
      if (queue.some((j) => !j.cancelled)) pump()
      else {
        queue.length = 0
        pumping = false
      }
    }
    if (job) job.run(next)
    else next()
  })
}

function enqueue(run: Job['run']): () => void {
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
    return enqueue((done) => {
      const painting = latest.current
      requestThumbnail(painting, useWorkspace.getState().assets, (result) => {
        if (result instanceof Error) {
          console.error(`Could not render the thumbnail of ${painting.id}`, result)
          setRendered({ key, result: 'failed' })
        } else {
          store(painting, result)
          setRendered({ key, result })
        }
        done()
      })
    })
  }, [key])

  return cached(key) ?? (rendered?.key === key ? rendered.result : null)
}
