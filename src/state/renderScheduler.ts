import type { EditLayer } from '../imaging/edits.ts'
import type { TextureSpec } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import type { RenderMessage, RenderReply, RenderRequest } from '../workers/protocol.ts'

/** Everything a render depends on. */
export interface RenderJob {
  spec: TextureSpec
  source: Raster | null
  edits: EditLayer | null
  /** Ask the renderer to prepare other shapes and thicknesses once idle. */
  prefetch: boolean
}

/** Where requests go (a worker, or a renderer on this thread) and where replies come from. */
export interface RenderPort {
  post(message: RenderMessage): void
  onReply: ((reply: RenderReply) => void) | null
}

export interface RenderResult {
  raster: Raster
  /** Share of see-through pixels, 0..1. */
  transparent: number
  job: RenderJob
}

export interface RenderScheduler {
  /** Renders `job` as soon as the renderer is free; a newer request replaces a waiting one. */
  request(job: RenderJob): void
  /** Drops the request in progress and the waiting one, and tells the renderer to let go. */
  forget(): void
  /** Sends everything to another port from now on (the worker could not start). */
  usePort(port: RenderPort): void
}

/**
 * Latest request wins: one request at a time goes to the renderer, and at most one waits,
 * replaced by any newer one. Every request has an increasing id; a reply that is not for the
 * request in progress (forgotten, or from a port no longer used) is dropped. Each reply that
 * does arrive is newer than what is on screen, so it is shown even when a newer request waits:
 * a long slider drag keeps updating instead of freezing until it ends.
 */
export function createRenderScheduler(
  initialPort: RenderPort,
  on: { rendered(result: RenderResult): void; failed(message: string, job: RenderJob): void },
): RenderScheduler {
  let port = initialPort
  let nextId = 0
  let inFlight: { id: number; job: RenderJob } | null = null
  let waiting: RenderJob | null = null
  // What the renderer holds; undefined = nothing sent yet (send it).
  let sentSource: Raster | null | undefined
  let sentEdits: EditLayer | null | undefined

  function send(job: RenderJob) {
    nextId++
    const message: RenderRequest = {
      kind: 'render',
      id: nextId,
      spec: job.spec,
      prefetch: job.prefetch,
    }
    if (job.source !== sentSource) {
      message.source = job.source
      sentSource = job.source
    }
    if (job.edits !== sentEdits) {
      message.edits = job.edits
      sentEdits = job.edits
    }
    inFlight = { id: nextId, job }
    port.post(message)
  }

  function sendWaiting() {
    if (inFlight || !waiting) return
    const next = waiting
    waiting = null
    send(next)
  }

  function receive(reply: RenderReply) {
    if (!inFlight || reply.id !== inFlight.id) return
    const { job } = inFlight
    inFlight = null
    // The renderer starts on the waiting request before this thread draws the result.
    sendWaiting()
    if (reply.kind === 'rendered') {
      on.rendered({ raster: reply.raster, transparent: reply.transparent, job })
    } else {
      on.failed(reply.message, job)
    }
  }

  function attach(next: RenderPort) {
    port.onReply = null
    port = next
    port.onReply = receive
    sentSource = undefined
    sentEdits = undefined
  }

  attach(initialPort)

  return {
    request(job) {
      waiting = job
      sendWaiting()
    },
    forget() {
      inFlight = null
      waiting = null
      sentSource = undefined
      sentEdits = undefined
      port.post({ kind: 'forget' })
    },
    usePort(next) {
      attach(next)
      const lost = inFlight?.job ?? null
      inFlight = null
      waiting ??= lost
      sendWaiting()
    },
  }
}
