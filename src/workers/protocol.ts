import type { EditLayer } from '../imaging/edits.ts'
import type { TextureSpec } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'

/**
 * Renders the painting. `source` and `edits` are sent only when they changed since the last
 * request (absent = keep the ones already held), so a picture crosses to the worker once.
 */
export interface RenderRequest {
  kind: 'render'
  /** Increases with every request; the reply carries it back. */
  id: number
  spec: TextureSpec
  source?: Raster | null
  edits?: EditLayer | null
  /** Prepare the likely next changes (other shapes, thicknesses) once idle. */
  prefetch: boolean
}

/** Drops the held picture, edits and every remembered stage (the editor closed). */
export interface ForgetRequest {
  kind: 'forget'
}

export type RenderMessage = RenderRequest | ForgetRequest

export type RenderReply =
  | { kind: 'rendered'; id: number; raster: Raster; transparent: number }
  | { kind: 'failed'; id: number; message: string }
