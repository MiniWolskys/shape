import type { Assets, Painting } from '../domain/types.ts'
import type { Raster } from '../imaging/raster.ts'

/** Image work kept off the page (R39): PNG encoding of chosen pictures, library thumbnails. */
export type ImageRequest =
  | { kind: 'encode'; id: number; raster: Raster }
  | { kind: 'thumbnail'; id: number; painting: Painting; assets: Assets }

export type ImageReply =
  | { kind: 'encoded'; id: number; bytes: Uint8Array }
  | { kind: 'thumbnail'; id: number; raster: Raster }
  | { kind: 'failed'; id: number; message: string }
