import type { EditLayer } from '../imaging/edits.ts'
import { createStagedRenderer, type StagedRenderer } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import type { Task } from '../imaging/shapeCache.ts'
import { transparentShare } from '../imaging/window.ts'
import type { RenderMessage, RenderReply } from './protocol.ts'

export interface RenderHost {
  handle(message: RenderMessage, reply: (r: RenderReply) => void): void
}

/**
 * The receiving end of render requests: holds the picture and edits it was sent and renders
 * with a staged renderer. The worker runs one; without workers the main thread runs one
 * directly. `background` runs prefetch work while idle (none: no prefetching).
 */
export function createRenderHost(
  options: { renderer?: StagedRenderer; background?: (task: Task | null) => void } = {},
): RenderHost {
  const renderer = options.renderer ?? createStagedRenderer()
  let source: Raster | null = null
  let edits: EditLayer | null = null

  return {
    handle(message, reply) {
      if (message.kind === 'forget') {
        options.background?.(null)
        source = null
        edits = null
        renderer.clear()
        return
      }
      if (message.source !== undefined) source = message.source
      if (message.edits !== undefined) edits = message.edits
      try {
        const raster = renderer.render(source, edits, message.spec)
        reply({ kind: 'rendered', id: message.id, raster, transparent: transparentShare(raster) })
      } catch (error) {
        reply({
          kind: 'failed',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      options.background?.(message.prefetch ? renderer.prefetch(message.spec) : null)
    },
  }
}
