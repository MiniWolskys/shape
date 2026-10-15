import { useEffect } from 'react'
import { create } from 'zustand'
import type { Painting } from '../domain/types.ts'
import type { EditLayer } from '../imaging/edits.ts'
import { FRAME_MATERIALS } from '../imaging/materials.ts'
import { createStagedRenderer } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import type { RenderMessage, RenderReply } from '../workers/protocol.ts'
import { createRenderHost } from '../workers/renderHost.ts'
import { useEditor } from './editor.ts'
import {
  createRenderScheduler,
  type RenderJob,
  type RenderPort,
  type RenderResult,
  type RenderScheduler,
} from './renderScheduler.ts'

export interface RenderedPainting {
  raster: Raster | null
  /** Share of see-through pixels, 0..1. */
  transparent: number
  /**
   * The raster is a stroke drawn over the last render, until the stroke's own render arrives:
   * slow previews (the wall) can wait for that one instead of drawing twice.
   */
  drawing: boolean
}

/** What the editor shows: the last render (or a stroke drawn over it) and what it was made of. */
interface Shown extends RenderedPainting {
  /** The inputs `raster` is exactly the render of; null when unknown. */
  job: RenderJob | null
}

const EMPTY: Shown = { raster: null, transparent: 0, drawing: false, job: null }

/**
 * The last render, shared by every caller: the stage, the inspector previews and the pixel
 * tools all read the same raster instead of each rendering their own. It stays on screen until
 * the next render arrives, so the painting never blinks.
 */
const useShown = create<Shown>(() => EMPTY)

/** Whether a pencil or eraser stroke is in progress (renders and slow previews wait for its end). */
export const useStroke = create<{ active: boolean }>(() => ({ active: false }))

/** Renders on this thread, for the pixel tools when nothing current is on screen (and tests). */
const local = createStagedRenderer()

const sameJob = (a: RenderJob, b: RenderJob) =>
  a.source === b.source &&
  a.edits === b.edits &&
  a.spec.id === b.spec.id &&
  a.spec.recipe === b.spec.recipe &&
  a.spec.width === b.spec.width &&
  a.spec.height === b.spec.height &&
  a.spec.pixelsPerBlock === b.spec.pixelsPerBlock

/** Only these fields reach the texture, so a new title does not render again. */
function jobOf(
  p: Painting,
  source: Raster | null,
  edits: EditLayer | null,
  prefetch = false,
): RenderJob {
  const { id, recipe, width, height, pixelsPerBlock } = p
  return { spec: { id, recipe, width, height, pixelsPerBlock }, source, edits, prefetch }
}

/** A renderer on this thread behind the same messages as the worker (no Worker, e.g. jsdom). */
function localPort(): RenderPort {
  const host = createRenderHost({ renderer: local })
  const port: RenderPort = {
    onReply: null,
    post(message: RenderMessage) {
      host.handle(message, (reply: RenderReply) => port.onReply?.(reply))
    },
  }
  return port
}

function workerPort(onLost: () => void): RenderPort | null {
  if (typeof Worker !== 'function') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch (error) {
    console.error('Could not start the render worker; rendering on the page instead', error)
    return null
  }
  const port: RenderPort = {
    onReply: null,
    post(message) {
      worker.postMessage(message)
    },
  }
  worker.onmessage = (event: MessageEvent<RenderReply>) => port.onReply?.(event.data)
  worker.onerror = (event) => {
    console.error('The render worker stopped; rendering on the page instead', event.message)
    worker.terminate()
    onLost()
  }
  return port
}

let scheduler: RenderScheduler | null = null
let lastRequested: RenderJob | null = null

function getScheduler(): RenderScheduler {
  if (scheduler) return scheduler
  const handlers = {
    rendered({ raster, transparent, job }: RenderResult) {
      // A stroke draws over what is on screen; its own render follows when it ends.
      if (useStroke.getState().active) return
      useShown.setState({ raster, transparent, drawing: false, job })
    },
    failed(message: string) {
      console.error('Could not render the painting', message)
    },
  }
  const created = createRenderScheduler(
    workerPort(() => created.usePort(localPort())) ?? localPort(),
    handlers,
  )
  scheduler = created
  return created
}

/** Asks for a render of `job` unless it is the one last asked for. */
function requestRender(job: RenderJob): void {
  if (lastRequested && sameJob(lastRequested, job) && lastRequested.prefetch === job.prefetch) {
    return
  }
  lastRequested = job
  getScheduler().request(job)
}

// Closing the editor drops the last render, so a closed painting's raster isn't kept alive.
useEditor.subscribe((state, previous) => {
  if (state.painting || !previous.painting) return
  useShown.setState(EMPTY)
  lastRequested = null
  stroke = null
  local.clear()
  scheduler?.forget()
})

/** The render kept for reuse, if any (for tests). */
export function cachedRender(): Raster | null {
  return useShown.getState().raster
}

/**
 * The editor's painting as it is right now: what the pixel tools pick from, so the wand and
 * the eyedropper see exactly what was last committed. That is what is on screen, unless a
 * render is still on its way; then it is rendered here.
 */
export function currentRaster(): Raster | null {
  const { painting, source, edits } = useEditor.getState()
  if (!painting) return null
  const job = jobOf(painting, source, edits)
  const shown = useShown.getState()
  if (shown.raster && shown.job && sameJob(shown.job, job)) return shown.raster
  return local.render(source, edits, painting)
}

/** Asks for a render of the editor's painting as it is now (not during a stroke). */
function requestCurrent(): void {
  if (useStroke.getState().active) return
  const { painting, source, edits, step } = useEditor.getState()
  if (!painting) return
  requestRender(jobOf(painting, source, edits, step === 'window'))
}

let users = 0
let stopFollowing: (() => void) | null = null

/**
 * While anything shows the render, every editor change asks for a new one straight away (in
 * the same task as the change, without waiting for React), and the end of a stroke too.
 */
function follow(): () => void {
  if (users++ === 0) {
    const editor = useEditor.subscribe(requestCurrent)
    const strokes = useStroke.subscribe(requestCurrent)
    stopFollowing = () => {
      editor()
      strokes()
    }
  }
  requestCurrent()
  return () => {
    if (--users > 0) return
    stopFollowing?.()
    stopFollowing = null
  }
}

/**
 * The editor's painting, rendered off the page (in a worker when the browser has them). The
 * last render stays on screen until the next one arrives; while a stroke is drawn, it is drawn
 * straight over that render, and the painting renders again when the stroke ends.
 */
export function useRenderedPainting(): RenderedPainting {
  const raster = useShown((s) => s.raster)
  const transparent = useShown((s) => s.transparent)
  const drawing = useShown((s) => s.drawing)
  useEffect(follow, [])
  return { raster, transparent, drawing }
}

/** The stroke being drawn over the last render. */
let stroke: {
  data: Uint8ClampedArray
  width: number
  height: number
  transparent: number
  frame: readonly [number, number, number]
  /** The job the base render was exactly made of (null if it was already out of date). */
  base: RenderJob | null
} | null = null

/** Starts a pencil or eraser stroke: from now on it is drawn over a copy of the last render. */
export function beginStroke(): void {
  useStroke.setState({ active: true })
  const shown = useShown.getState()
  const { painting, source, edits } = useEditor.getState()
  if (!shown.raster || !painting) {
    stroke = null
    return
  }
  const current = jobOf(painting, source, edits)
  stroke = {
    data: new Uint8ClampedArray(shown.raster.data),
    width: shown.raster.width,
    height: shown.raster.height,
    transparent: shown.transparent,
    frame: FRAME_MATERIALS[painting.recipe.frame.material].color,
    base: shown.job && sameJob(shown.job, current) ? current : null,
  }
}

/**
 * Shows the stroke's edits inside `box` (inclusive painting pixels) without rendering: each
 * edited pixel takes its edit value, and see-through ones the frame colour (R12), exactly as
 * the full render does it.
 */
export function previewStroke(
  layer: EditLayer,
  box: { x0: number; y0: number; x1: number; y1: number },
): void {
  const s = stroke
  if (!s || layer.values.width !== s.width || layer.values.height !== s.height) return
  const x0 = Math.max(0, box.x0)
  const y0 = Math.max(0, box.y0)
  const x1 = Math.min(s.width - 1, box.x1)
  const y1 = Math.min(s.height - 1, box.y1)
  const values = layer.values.data
  const pixels = s.width * s.height
  const [fr, fg, fb] = s.frame
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * s.width + x
      if (layer.mask[p] !== 1) continue
      const i = p * 4
      const a = values[i + 3] ?? 0
      s.transparent += ((s.data[i + 3] ?? 0) - a) / 255 / pixels
      s.data[i] = a === 0 ? fr : (values[i] ?? 0)
      s.data[i + 1] = a === 0 ? fg : (values[i + 1] ?? 0)
      s.data[i + 2] = a === 0 ? fb : (values[i + 2] ?? 0)
      s.data[i + 3] = a
    }
  }
  useShown.setState({
    // A new raster object around the same pixels, so the canvas draws again.
    raster: { width: s.width, height: s.height, data: s.data },
    transparent: s.transparent,
    drawing: true,
    job: s.base && { ...s.base, edits: layer },
  })
}

/** Ends the stroke; the painting renders again with its edits. */
export function endStroke(): void {
  stroke = null
  // Renders that arrived during the stroke were not shown: always render again after it.
  lastRequested = null
  useStroke.setState({ active: false })
}
