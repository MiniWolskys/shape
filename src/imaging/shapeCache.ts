import { SHAPE_IDS } from '../domain/types.ts'
import {
  classifyShapeSteps,
  FRAME_BOUND,
  reframeShape,
  shapeEdge,
  type ShapeMap,
  type ShapeOptions,
} from './window.ts'

/** Classifications of one shape at one size: frameless, its edge, and the last framed one. */
interface Entry {
  zero?: ShapeMap
  edge?: Int32Array
  framed?: { frame: number; map: ShapeMap }
}

/** Shapes kept (all of them at one size, plus a few left from another size). */
const ENTRY_LIMIT = SHAPE_IDS.length + 3

/** Work that can be cut into small steps; each `next()` does a little of it. */
export type Task = Generator<void, void>

export interface ShapeCache {
  /** The classified shape, from memory when possible; `onClassify` runs when it was not. */
  get(width: number, height: number, o: ShapeOptions): ShapeMap
  /**
   * Background work that makes the next likely changes instant: the edge of this shape (any
   * thickness up to FRAME_BOUND), then every other shape at this thickness.
   */
  prefetch(width: number, height: number, o: ShapeOptions): Task
  clear(): void
}

/** Runs a stepwise classification to the end. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}

export function createShapeCache(onClassify: () => void = () => {}): ShapeCache {
  const entries = new Map<string, Entry>()

  function entry(width: number, height: number, o: ShapeOptions): Entry {
    const key = `${o.shape}|${width}|${height}|${o.pixelsPerBlock}|${o.seed}`
    let e = entries.get(key)
    if (e) entries.delete(key)
    else e = {}
    // Most recently used last; the oldest goes first.
    entries.set(key, e)
    while (entries.size > ENTRY_LIMIT) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
    return e
  }

  function cached(e: Entry, o: ShapeOptions): ShapeMap | null {
    if (o.frame === 0 && e.zero) return e.zero
    if (e.framed?.frame === o.frame) return e.framed.map
    if (e.zero && e.edge && o.frame <= FRAME_BOUND) {
      const map = reframeShape(e.zero, e.edge, o)
      e.framed = { frame: o.frame, map }
      return map
    }
    return null
  }

  function* classify(width: number, height: number, o: ShapeOptions): Generator<void, ShapeMap> {
    const map = yield* classifyShapeSteps(width, height, o)
    onClassify()
    return map
  }

  function* prepareEdge(width: number, height: number, o: ShapeOptions): Task {
    const e = entry(width, height, o)
    if (e.zero && e.edge) return
    const zero = e.zero ?? (yield* classify(width, height, { ...o, frame: 0 }))
    const bounded = yield* classify(width, height, { ...o, frame: FRAME_BOUND })
    const now = entry(width, height, o)
    now.zero = zero
    now.edge = shapeEdge(zero, bounded)
  }

  return {
    get(width, height, o) {
      const e = entry(width, height, o)
      const hit = cached(e, o)
      if (hit) return hit
      const map = finish(classify(width, height, o))
      if (o.frame === 0) e.zero = map
      else e.framed = { frame: o.frame, map }
      return map
    },

    *prefetch(width, height, o) {
      yield* prepareEdge(width, height, o)
      for (const shape of SHAPE_IDS) {
        if (shape === o.shape) continue
        const other = { ...o, shape }
        if (cached(entry(width, height, other), other)) continue
        const map = yield* classify(width, height, other)
        const e = entry(width, height, other)
        if (o.frame === 0) e.zero = map
        else e.framed = { frame: o.frame, map }
      }
    },

    clear() {
      entries.clear()
    },
  }
}
