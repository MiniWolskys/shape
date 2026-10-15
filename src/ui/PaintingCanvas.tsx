import { useEffect, useRef } from 'react'
import type { Raster } from '../imaging/raster.ts'
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
}

function displayScale(raster: Raster, scale?: number, fit?: { width: number; height: number }) {
  if (scale !== undefined) return scale
  if (!fit || raster.width === 0 || raster.height === 0) return 1
  const contain = Math.min(fit.width / raster.width, fit.height / raster.height)
  return contain >= 1 ? Math.floor(contain) : contain
}

export function PaintingCanvas({ raster, scale, fit, label, backdrop }: PaintingCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Kept between draws: a big painting redrawn on every stroke frame would otherwise allocate
  // megabytes per frame and stall on garbage collection.
  const image = useRef<ImageData | null>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx || raster.width === 0 || raster.height === 0) return
    let pixels = image.current
    if (!pixels || pixels.width !== raster.width || pixels.height !== raster.height) {
      pixels = ctx.createImageData(raster.width, raster.height)
      image.current = pixels
    }
    pixels.data.set(raster.data)
    ctx.putImageData(pixels, 0, 0)
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
