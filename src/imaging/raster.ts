export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type RGB = readonly [number, number, number]
export type RGBA = readonly [number, number, number, number]

/** Creates an RGBA, row-major raster. Defaults to transparent black. */
export function createRaster(width: number, height: number, fill?: RGBA): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill) {
    const [r, g, b, a] = fill
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data }
}

export function getPixel(r: Raster, x: number, y: number): RGBA {
  const i = (y * r.width + x) * 4
  return [r.data[i] ?? 0, r.data[i + 1] ?? 0, r.data[i + 2] ?? 0, r.data[i + 3] ?? 0]
}

export function setPixel(r: Raster, x: number, y: number, c: RGBA): void {
  const i = (y * r.width + x) * 4
  r.data[i] = c[0]
  r.data[i + 1] = c[1]
  r.data[i + 2] = c[2]
  r.data[i + 3] = c[3]
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) }
}
