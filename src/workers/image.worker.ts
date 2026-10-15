import type { ImageReply, ImageRequest } from './imageProtocol.ts'
import { runImageJob } from './imageJobs.ts'

/** The worker's global scope, typed by hand (the app is typed against the DOM). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImageRequest>) => void) | null
  postMessage(message: ImageReply, transfer: Transferable[]): void
}

scope.onmessage = (event) => {
  const reply = runImageJob(event.data)
  // The result is this worker's own fresh copy: hand its buffer over instead of copying it.
  let transfer: Transferable[] = []
  if (reply.kind === 'encoded') transfer = [reply.bytes.buffer as ArrayBuffer]
  else if (reply.kind === 'thumbnail') transfer = [reply.raster.data.buffer as ArrayBuffer]
  scope.postMessage(reply, transfer)
}
