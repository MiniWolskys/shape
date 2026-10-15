import type { Assets, Painting } from '../domain/types.ts'
import type { Raster } from '../imaging/raster.ts'
import { thumbnailAssets } from '../state/thumbnailRender.ts'
import { runImageJob } from './imageJobs.ts'
import type { ImageReply, ImageRequest } from './imageProtocol.ts'

type Done = (reply: ImageReply) => void

/** The one image worker, started on first use; 'page' once workers proved unavailable. */
let worker: Worker | 'page' | null = null
const pending = new Map<number, { request: ImageRequest; done: Done }>()
let nextId = 1

function imageWorker(): Worker | null {
  if (worker === 'page') return null
  if (worker) return worker
  if (typeof Worker !== 'function') {
    worker = 'page'
    return null
  }
  let started: Worker
  try {
    started = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    console.error('Could not start the image worker; working on the page instead', error)
    worker = 'page'
    return null
  }
  started.onmessage = (event: MessageEvent<ImageReply>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    job.done(event.data)
  }
  started.onerror = (event) => {
    console.error('The image worker stopped; working on the page instead', event.message)
    started.terminate()
    worker = 'page'
    const jobs = [...pending.values()]
    pending.clear()
    for (const job of jobs) job.done(runImageJob(job.request))
  }
  worker = started
  return started
}

/** Runs the job in the image worker, or right here (synchronously) without one. */
function run(request: ImageRequest, done: Done): void {
  const target = imageWorker()
  if (!target) {
    done(runImageJob(request))
    return
  }
  pending.set(request.id, { request, done })
  target.postMessage(request)
}

/** PNG bytes of a raster, encoded off the page (R39): a 2048 px picture takes about a second. */
export function encodePngOffThread(raster: Raster): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    run({ kind: 'encode', id: nextId++, raster }, (reply) => {
      if (reply.kind === 'encoded') resolve(reply.bytes)
      else reject(new Error(reply.kind === 'failed' ? reply.message : 'Unexpected image reply'))
    })
  })
}

/**
 * Renders a painting's library thumbnail off the page (see renderThumbnail). `done` gets the
 * raster or the error; without workers it is called before this returns.
 */
export function requestThumbnail(
  painting: Painting,
  assets: Assets,
  done: (result: Raster | Error) => void,
): void {
  const request: ImageRequest = {
    kind: 'thumbnail',
    id: nextId++,
    painting,
    assets: thumbnailAssets(painting, assets),
  }
  run(request, (reply) => {
    if (reply.kind === 'thumbnail') done(reply.raster)
    else done(new Error(reply.kind === 'failed' ? reply.message : 'Unexpected image reply'))
  })
}

/** Forgets the worker (tests start each case afresh). */
export function resetImageWorker(): void {
  if (worker && worker !== 'page') worker.terminate()
  worker = null
  pending.clear()
}
