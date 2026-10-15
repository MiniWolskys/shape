import { create } from 'zustand'
import { canResize, updatePainting } from '../domain/library.ts'
import type { Painting } from '../domain/types.ts'
import { resampleEdits, type EditLayer } from '../imaging/edits.ts'
import type { Raster, RGBA } from '../imaging/raster.ts'
import { centeredCrop } from '../imaging/transform.ts'

export type EditorStep = 'image' | 'size' | 'window' | 'pixels' | 'details'
export const EDITOR_STEPS: readonly EditorStep[] = ['image', 'size', 'window', 'pixels', 'details']
export type CanvasView = 'edit' | 'wall' | 'nomod'
export type BackdropChoice = 'auto' | 'light' | 'dark' | 'sky'
export type Tool = 'pencil' | 'fill' | 'replace' | 'wand' | 'eyedropper' | 'eraser'

export interface Snapshot {
  painting: Painting
  edits: EditLayer | null
}

export const HISTORY_LIMIT = 60
/** Undo memory budget over the distinct edit layers it holds (5 bytes per pixel). */
export const HISTORY_BYTES = 64 * 1024 * 1024
/** Zoom 0 means "fit the stage"; otherwise CSS pixels per painting pixel. */
export const MAX_ZOOM = 64
/** Changes with the same merge key this close together form one undo step (slider drags). */
const MERGE_WINDOW_MS = 1500

export const NO_CROP = { x: 0, y: 0, width: 0, height: 0 } as const

export interface ChangeOptions {
  /** Consecutive changes sharing this key replace each other in the history. */
  merge?: string
  /**
   * With `merge`: keep merging until `endGesture`, however long the pauses (a pencil stroke
   * held still is still one stroke).
   */
  gesture?: boolean
}

export interface EditorState {
  painting: Painting | null
  source: Raster | null
  edits: EditLayer | null
  step: EditorStep
  view: CanvasView
  backdrop: BackdropChoice
  zoom: number
  showGrid: boolean
  tool: Tool
  color: RGBA
  tolerance: number
  contiguous: boolean
  selection: Uint8Array | null
  past: Snapshot[]
  future: Snapshot[]
  dirty: boolean
  open(p: Painting, source: Raster | null, edits: EditLayer | null): void
  /** Forgets the open painting and its history (when the editor screen goes away). */
  close(): void
  /** Pushes history (max 60 snapshots); a patch returning the same painting is ignored. */
  change(patch: (p: Painting) => Painting, options?: ChangeOptions): void
  /**
   * Uses a new picture and resets the crop to the centred crop; undoable. A painting's first
   * picture also sizes it to fit (R20, see `autoSize`) when it is still 1×1 without pixel edits
   * and was not resized in this session: one undo step, and the new size is returned.
   */
  setSource(r: Raster, imageId: string): { autoSized: { width: number; height: number } | null }
  /**
   * Pushes history. Tools must pass a fresh layer and never mutate `edits` in place: the
   * history keeps references to earlier layers, and the save and render memos compare by identity.
   * (A pencil stroke reuses its own working pixels from frame to frame, in a new layer object
   * each time; its frames merge into one undo step, so the history never holds them.)
   */
  setEdits(layer: EditLayer, options?: ChangeOptions): void
  /** Resamples edits; throws ShapeError('published-locked') via updatePainting. */
  resize(width: number, height: number, ppb: number): void
  undo(): void
  redo(): void
  /**
   * After a save: the given painting becomes the current, clean state. A save may give the
   * painting a new id (its title changed, R17): the whole history follows it.
   */
  markSaved(p: Painting): void
  /** Ends a pointer gesture: the next merged change starts a new undo step. */
  endGesture(): void
  setStep(step: EditorStep): void
  setView(view: CanvasView): void
  setBackdrop(backdrop: BackdropChoice): void
  setZoom(zoom: number): void
  toggleGrid(): void
  setTool(tool: Tool): void
  setColor(color: RGBA): void
  setTolerance(tolerance: number): void
  setContiguous(contiguous: boolean): void
  setSelection(selection: Uint8Array | null): void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Size of the source after rotation, which is what the crop is measured in. */
export function turnedSize(
  source: { width: number; height: number },
  rotation: Painting['recipe']['rotation'],
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height }
}

/** R4: thickness is in real pixels, so it follows the resolution (rounded, min 1 unless 0). */
function scaleThickness(thickness: number, fromPpb: number, toPpb: number): number {
  if (thickness === 0 || fromPpb === toPpb) return thickness
  return Math.max(1, Math.round((thickness * toPpb) / fromPpb))
}

const layerBytes = (layer: EditLayer) => layer.mask.length * 5

/**
 * Drops the oldest past entries until the distinct edit layers of the history (and the current
 * one) fit the memory budget.
 */
function trimToBudget(past: Snapshot[], future: Snapshot[], current: EditLayer | null): Snapshot[] {
  const total = (entries: Snapshot[]) => {
    const layers = new Set<EditLayer>()
    for (const s of entries) if (s.edits) layers.add(s.edits)
    if (current) layers.add(current)
    let bytes = 0
    for (const layer of layers) bytes += layerBytes(layer)
    return bytes
  }
  let start = 0
  while (start < past.length && total([...past.slice(start), ...future]) > HISTORY_BYTES) start++
  return start === 0 ? past : past.slice(start)
}

/** Largest painting side, in blocks, a first picture is sized to. */
const AUTO_SIZE_MAX = 4

/**
 * The size in 1..4 blocks per side whose ratio is closest to the picture's (compared as
 * log ratios, so 2:1 and 1:2 are as far from 1:1); on a tie the larger area wins.
 */
export function autoSize(
  pictureWidth: number,
  pictureHeight: number,
): { width: number; height: number } {
  const target = Math.log(pictureWidth / pictureHeight)
  let best = { width: 1, height: 1 }
  let bestError = Infinity
  for (let width = 1; width <= AUTO_SIZE_MAX; width++) {
    for (let height = 1; height <= AUTO_SIZE_MAX; height++) {
      const error = Math.abs(Math.log(width / height) - target)
      const tie = Math.abs(error - bestError) < 1e-9
      if (tie ? width * height > best.width * best.height : error < bestError) {
        best = { width, height }
        bestError = Math.min(error, bestError)
      }
    }
  }
  return best
}

/**
 * The crop was moved or zoomed by the player: it is not empty (centred by the renderer) nor the
 * centred crop a new picture gets. Resetting it then loses work worth mentioning (M13).
 */
export function isCustomCrop(p: Painting): boolean {
  const { crop, source, rotation } = p.recipe
  if (!source || crop.width === 0 || crop.height === 0) return false
  const turned = turnedSize(source, rotation)
  const centred = centeredCrop(turned.width, turned.height, p.width, p.height)
  return (
    crop.x !== centred.x ||
    crop.y !== centred.y ||
    crop.width !== centred.width ||
    crop.height !== centred.height
  )
}

/** The step each painting was last shown on, in this session (by painting id). */
const lastSteps = new Map<string, EditorStep>()

/** Forgets the remembered steps (for tests). */
export function forgetLastSteps(): void {
  lastSteps.clear()
}

/** Pictures by asset id, so undoing a new picture brings the old raster back. */
let rasters = new Map<string, Raster>()

/** Asset ids of the pictures the editor keeps in memory (for tests). */
export function cachedPictureIds(): string[] {
  return [...rasters.keys()]
}

export const useEditor = create<EditorState>()((set, get) => {
  let saved: Snapshot | null = null
  let lastMerge: { key: string; at: number } | null = null
  /** The player changed the size of the open painting: a first picture keeps it (R20). */
  let resized = false

  const isSaved = (painting: Painting, edits: EditLayer | null) =>
    saved !== null && saved.painting === painting && saved.edits === edits

  /** Records the current state in the history and moves to `next`. */
  /** Keeps only the pictures the current state or the history still refers to. */
  const pruneRasters = (entries: Snapshot[]) => {
    const used = new Set(entries.map((s) => s.painting.recipe.source?.imageId))
    for (const id of [...rasters.keys()]) if (!used.has(id)) rasters.delete(id)
  }

  const commit = (next: Snapshot, options?: ChangeOptions, extra: Partial<EditorState> = {}) => {
    const { painting, edits, past } = get()
    if (!painting) return
    const now = Date.now()
    const merging =
      options?.merge !== undefined &&
      lastMerge?.key === options.merge &&
      (options.gesture === true || now - lastMerge.at < MERGE_WINDOW_MS) &&
      past.length > 0
    lastMerge = options?.merge !== undefined ? { key: options.merge, at: now } : null
    const pushed = merging ? past : [...past, { painting, edits }].slice(-HISTORY_LIMIT)
    const nextPast = trimToBudget(pushed, [], next.edits)
    pruneRasters([...nextPast, next])
    set({
      ...extra,
      painting: next.painting,
      edits: next.edits,
      past: nextPast,
      future: [],
      dirty: !isSaved(next.painting, next.edits),
    })
  }

  /**
   * Moves to a snapshot from the history with the right picture. A snapshot with edits keeps the
   * edits id saved since; one without edits has none, so saving it drops the stale edit assets.
   */
  const restore = (snap: Snapshot): Pick<EditorState, 'painting' | 'edits' | 'source'> => {
    const editsId = snap.edits
      ? (get().painting?.recipe.editsId ?? snap.painting.recipe.editsId)
      : null
    const painting =
      snap.painting.recipe.editsId !== editsId
        ? { ...snap.painting, recipe: { ...snap.painting.recipe, editsId } }
        : snap.painting
    const imageId = painting.recipe.source?.imageId
    return {
      painting,
      edits: snap.edits,
      source: imageId === undefined ? null : (rasters.get(imageId) ?? null),
    }
  }

  return {
    painting: null,
    source: null,
    edits: null,
    step: 'image',
    view: 'edit',
    backdrop: 'auto',
    zoom: 0,
    showGrid: false,
    tool: 'pencil',
    color: [254, 216, 61, 255],
    tolerance: 12,
    contiguous: true,
    selection: null,
    past: [],
    future: [],
    dirty: false,

    open(p, source, edits) {
      rasters = new Map()
      const imageId = p.recipe.source?.imageId
      if (source && imageId) rasters.set(imageId, source)
      saved = { painting: p, edits }
      lastMerge = null
      resized = false
      set({
        painting: p,
        source,
        edits,
        step: lastSteps.get(p.id) ?? 'image',
        view: 'edit',
        zoom: 0,
        selection: null,
        past: [],
        future: [],
        dirty: false,
      })
    },

    close() {
      rasters = new Map()
      saved = null
      lastMerge = null
      set({
        painting: null,
        source: null,
        edits: null,
        selection: null,
        past: [],
        future: [],
        dirty: false,
      })
    },

    change(patch, options) {
      const { painting, edits } = get()
      if (!painting) return
      const next = patch(painting)
      if (next === painting) return
      commit({ painting: next, edits }, options)
    },

    setSource(r, imageId) {
      const { painting, edits } = get()
      if (!painting) return { autoSized: null }
      rasters.set(imageId, r)
      const turned = turnedSize(r, painting.recipe.rotation)
      const fits =
        painting.recipe.source === null &&
        painting.width === 1 &&
        painting.height === 1 &&
        edits === null &&
        !resized &&
        canResize(painting)
      const autoSized = fits ? autoSize(turned.width, turned.height) : null
      const size = autoSized ?? { width: painting.width, height: painting.height }
      const next: Painting = {
        ...painting,
        ...size,
        recipe: {
          ...painting.recipe,
          source: { imageId, width: r.width, height: r.height },
          crop: centeredCrop(turned.width, turned.height, size.width, size.height),
        },
      }
      commit({ painting: next, edits }, undefined, { source: r })
      return { autoSized }
    },

    setEdits(layer, options) {
      const { painting } = get()
      if (!painting) return
      commit({ painting, edits: layer }, options)
    },

    resize(width, height, ppb) {
      const { painting, edits } = get()
      if (!painting) return
      const sizeChanged = width !== painting.width || height !== painting.height
      if (!sizeChanged && ppb === painting.pixelsPerBlock) return
      if (sizeChanged && canResize(painting)) resized = true
      const { recipe } = painting
      const next = updatePainting(
        painting,
        {
          width,
          height,
          pixelsPerBlock: ppb,
          recipe: {
            ...recipe,
            crop: sizeChanged ? { ...NO_CROP } : recipe.crop,
            frame: {
              ...recipe.frame,
              thickness: scaleThickness(recipe.frame.thickness, painting.pixelsPerBlock, ppb),
            },
          },
        },
        new Date(),
      )
      const nextEdits = edits && resampleEdits(edits, width * ppb, height * ppb)
      commit({ painting: next, edits: nextEdits }, undefined, { selection: null })
    },

    undo() {
      const { painting, edits, past, future } = get()
      const previous = past.at(-1)
      if (!painting || !previous) return
      lastMerge = null
      const restored = restore(previous)
      set({
        ...restored,
        past: past.slice(0, -1),
        future: [{ painting, edits }, ...future],
        selection: null,
        dirty: !isSaved(previous.painting, previous.edits),
      })
    },

    redo() {
      const { painting, edits, past, future } = get()
      const [next, ...rest] = future
      if (!painting || !next) return
      lastMerge = null
      const restored = restore(next)
      const nextPast = trimToBudget(
        [...past, { painting, edits }].slice(-HISTORY_LIMIT),
        rest,
        next.edits,
      )
      pruneRasters([...nextPast, next, ...rest])
      set({
        ...restored,
        past: nextPast,
        future: rest,
        selection: null,
        dirty: !isSaved(next.painting, next.edits),
      })
    },

    markSaved(p) {
      const { painting, edits, past, future, step } = get()
      if (!painting) return
      const renamed = p.id !== painting.id
      if (renamed) lastSteps.set(p.id, step)
      // Snapshots that are the current state point at the saved painting from now on; after a
      // new id, every other one takes it too.
      const swap = (s: Snapshot) => {
        if (s.painting === painting) return { ...s, painting: p }
        return renamed ? { ...s, painting: { ...s.painting, id: p.id } } : s
      }
      saved = { painting: p, edits }
      lastMerge = null
      set({ painting: p, past: past.map(swap), future: future.map(swap), dirty: false })
    },

    endGesture() {
      lastMerge = null
    },

    setStep(step) {
      const id = get().painting?.id
      if (id !== undefined) lastSteps.set(id, step)
      set({ step })
    },
    setView: (view) => set({ view }),
    setBackdrop: (backdrop) => set({ backdrop }),
    setZoom: (zoom) => set({ zoom: clamp(zoom, 0, MAX_ZOOM) }),
    toggleGrid: () => set({ showGrid: !get().showGrid }),
    setTool: (tool) => set({ tool }),
    setColor: (color) => set({ color }),
    setTolerance: (tolerance) => set({ tolerance: clamp(Math.round(tolerance), 0, 100) }),
    setContiguous: (contiguous) => set({ contiguous }),
    setSelection: (selection) => set({ selection }),
  }
})
