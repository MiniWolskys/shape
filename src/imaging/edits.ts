import { cloneRaster, createRaster, type Raster } from './raster.ts'

/** Hand edits over the rendered painting. `mask[i]` is 1 when pixel i is edited. */
export interface EditLayer {
  values: Raster
  mask: Uint8Array
}

export function createEditLayer(width: number, height: number): EditLayer {
  return { values: createRaster(width, height), mask: new Uint8Array(width * height) }
}

/** Replaces every masked pixel of `base` (alpha included) with the layer's value. */
export function applyEdits(base: Raster, layer: EditLayer): Raster {
  if (base.width !== layer.values.width || base.height !== layer.values.height) {
    throw new RangeError(
      `Edit layer is ${layer.values.width}x${layer.values.height}, painting is ${base.width}x${base.height}`,
    )
  }
  const out = cloneRaster(base)
  const src = layer.values.data
  for (let p = 0; p < layer.mask.length; p++) {
    if (layer.mask[p] !== 1) continue
    const i = p * 4
    out.data.set(src.subarray(i, i + 4), i)
  }
  return out
}

/** Nearest-neighbour resize of values and mask together, so edits stay aligned. */
export function resampleEdits(layer: EditLayer, width: number, height: number): EditLayer {
  const out = createEditLayer(width, height)
  const sw = layer.values.width
  const sh = layer.values.height
  const src = layer.values.data
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / width))
      const sp = sy * sw + sx
      const dp = y * width + x
      out.mask[dp] = layer.mask[sp] ?? 0
      out.values.data.set(src.subarray(sp * 4, sp * 4 + 4), dp * 4)
    }
  }
  return out
}

export function isEmptyLayer(layer: EditLayer): boolean {
  return layer.mask.every((m) => m === 0)
}
