import { ShapeError } from '../domain/errors.ts'
import type { Raster } from './raster.ts'
import { fitWithin } from './transform.ts'

const MAX_SIDE = 2048

type Context2D = Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData'>

function context2d(width: number, height: number): Context2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')
}

/** Decodes a picture file into a raster no larger than 2048 px on its longest side. */
export async function fileToRaster(file: Blob): Promise<Raster> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    if (width === 0 || height === 0) throw new Error('the picture is empty')
    const ctx = context2d(width, height)
    if (!ctx) throw new Error('no 2D canvas available')
    ctx.drawImage(bitmap, 0, 0)
    const data = new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data)
    return fitWithin({ width, height, data }, MAX_SIDE)
  } catch (e) {
    throw new ShapeError(
      'not-an-image',
      `This file could not be read as a picture: ${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    bitmap?.close()
  }
}
