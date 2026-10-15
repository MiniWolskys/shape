import { encodePng } from '../packs/png.ts'
import { renderThumbnail } from '../state/thumbnailRender.ts'
import type { ImageReply, ImageRequest } from './imageProtocol.ts'

/** Does one image job: in the image worker, or on the page without one. */
export function runImageJob(request: ImageRequest): ImageReply {
  try {
    if (request.kind === 'encode') {
      return { kind: 'encoded', id: request.id, bytes: encodePng(request.raster) }
    }
    return {
      kind: 'thumbnail',
      id: request.id,
      raster: renderThumbnail(request.painting, request.assets),
    }
  } catch (error) {
    return {
      kind: 'failed',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
