import type { Task } from '../imaging/shapeCache.ts'
import type { RenderMessage, RenderReply } from './protocol.ts'
import { createRenderHost } from './renderHost.ts'

/** The worker's global scope, typed by hand (the app is typed against the DOM). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderMessage>) => void) | null
  postMessage(message: RenderReply, transfer: Transferable[]): void
}

/** Background work runs in slices this long, so a new request waits at most about this much. */
const SLICE_MS = 6

let task: Task | null = null
/** Whether a slice is already queued. */
let ticking = false
const tick = new MessageChannel()
tick.port1.onmessage = () => {
  ticking = false
  const end = performance.now() + SLICE_MS
  while (task && performance.now() < end) {
    if (task.next().done) task = null
  }
  schedule()
}

function schedule() {
  if (!task || ticking) return
  ticking = true
  tick.port2.postMessage(null)
}

const host = createRenderHost({
  background(next) {
    task = next
    schedule()
  },
})

scope.onmessage = (event) => {
  host.handle(event.data, (reply) => {
    // The raster is the worker's own fresh copy: hand its buffer over instead of copying it.
    const transfer = reply.kind === 'rendered' ? [reply.raster.data.buffer as ArrayBuffer] : []
    scope.postMessage(reply, transfer)
  })
}
