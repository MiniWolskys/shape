import { useEffect, useRef } from 'react'
import type { PixelBox, Raster } from '../imaging/raster.ts'
import type { BackdropKind } from './backdrop.ts'
import { Backdrop } from './Backdrop.tsx'
import styles from './PaintingCanvas.module.css'

interface PaintingCanvasProps {
  raster: Raster
  /** CSS pixels per raster pixel. Wins over `fit`. */
  scale?: number
  /** Contain within this box; whole-number scale when enlarging. */
  fit?: { width: number; height: number }
  label: string
  backdrop?: BackdropKind
  /**
   * The only area (inclusive raster pixels) that changed since the last draw, when the raster
   * holds the same pixel buffer as then (a stroke drawn in place). Otherwise everything is drawn.
   */
  dirty?: PixelBox | null
  /** Called after each draw (the stroke preview then starts a new dirty area). */
  onDrawn?(): void
}

/** Image data can only wrap pixels in a plain (not shared) buffer. */
function ownsBuffer(data: Uint8ClampedArray): data is Uint8ClampedArray<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer
}

/** The raster's own pixels as image data, without copying them when the browser allows. */
function wrap(ctx: CanvasRenderingContext2D, raster: Raster): ImageData {
  const { data, width, height } = raster
  if (typeof ImageData === 'function' && ownsBuffer(data) && data.length === width * height * 4) {
    return new ImageData(data, width, height)
  }
  const image = ctx.createImageData(raster.width, raster.height)
  image.data.set(raster.data)
  return image
}

function displayScale(raster: Raster, scale?: number, fit?: { width: number; height: number }) {
  if (scale !== undefined) return scale
  if (!fit || raster.width === 0 || raster.height === 0) return 1
  const contain = Math.min(fit.width / raster.width, fit.height / raster.height)
  return contain >= 1 ? Math.floor(contain) : contain
}

export function PaintingCanvas({
  raster,
  scale,
  fit,
  label,
  backdrop,
  dirty,
  onDrawn,
}: PaintingCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  /**
   * The last raster's pixels as image data, and the buffer they came from. A stroke draws into
   * one buffer frame after frame: only the area it changed is drawn again, from the same image
   * data, instead of copying and uploading megabytes per frame.
   */
  const image = useRef<{ data: ImageData; source: Uint8ClampedArray } | null>(null)
  const latest = useRef({ dirty, onDrawn })
  useEffect(() => {
    latest.current = { dirty, onDrawn }
  })

  useEffect(() => {
    // Desynchronized: a draw reaches the screen without waiting for the page's compositor,
    // which kept stroke frames of big paintings waiting 50-250 ms.
    const ctx = ref.current?.getContext('2d', { desynchronized: true })
    if (!ctx || raster.width === 0 || raster.height === 0) return
    const { dirty: box, onDrawn: drawn } = latest.current
    const kept = image.current
    const same =
      kept !== null &&
      kept.source === raster.data &&
      kept.data.width === raster.width &&
      kept.data.height === raster.height &&
      kept.data.data === raster.data
    if (same && box) {
      const x0 = Math.max(0, box.x0)
      const y0 = Math.max(0, box.y0)
      const x1 = Math.min(raster.width - 1, box.x1)
      const y1 = Math.min(raster.height - 1, box.y1)
      if (x1 >= x0 && y1 >= y0) ctx.putImageData(kept.data, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    } else {
      const data = wrap(ctx, raster)
      image.current = { data, source: raster.data }
      ctx.putImageData(data, 0, 0)
    }
    drawn?.()
  }, [raster])

  const s = displayScale(raster, scale, fit)
  const canvas = (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={styles.canvas}
      width={raster.width}
      height={raster.height}
      style={{ width: `${raster.width * s}px`, height: `${raster.height * s}px` }}
    />
  )
  if (!backdrop) return canvas
  return (
    <Backdrop kind={backdrop} className={styles.frame}>
      {canvas}
    </Backdrop>
  )
}
