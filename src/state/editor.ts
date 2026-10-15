import { create } from 'zustand'
import { updatePainting } from '../domain/library.ts'
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
/** Zoom 0 means "fit the stage"; otherwise CSS pixels per painting pixel. */
export const MAX_ZOOM = 64
/** Changes with the same merge key this close together form one undo step (slider drags). */
const MERGE_WINDOW_MS = 1500

export const NO_CROP = { x: 0, y: 0, width: 0, height: 0 } as const

export interface ChangeOptions {
  /** Consecutive changes sharing this key replace each other in the history. */
  merge?: string
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
  /** Uses a new picture and resets the crop to the centred crop; undoable. */
  setSource(r: Raster, imageId: string): void
  /** Pushes history. */
  setEdits(layer: EditLayer): void
  /** Resamples edits; throws ShapeError('published-locked') via updatePainting. */
  resize(width: number, height: number, ppb: number): void
  undo(): void
  redo(): void
  /** After a save: the given painting becomes the current, clean state. */
  markSaved(p: Painting): void
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

export const useEditor = create<EditorState>()((set, get) => {
  /** Pictures by asset id, so undoing a new picture brings the old raster back. */
  let rasters = new Map<string, Raster>()
  let saved: Snapshot | null = null
  let lastMerge: { key: string; at: number } | null = null

  const isSaved = (painting: Painting, edits: EditLayer | null) =>
    saved !== null && saved.painting === painting && saved.edits === edits

  /** Records the current state in the history and moves to `next`. */
  const commit = (next: Snapshot, options?: ChangeOptions) => {
    const { painting, edits, past } = get()
    if (!painting) return
    const now = Date.now()
    const merging =
      options?.merge !== undefined &&
      lastMerge?.key === options.merge &&
      now - lastMerge.at < MERGE_WINDOW_MS &&
      past.length > 0
    lastMerge = options?.merge !== undefined ? { key: options.merge, at: now } : null
    const nextPast = merging ? past : [...past, { painting, edits }].slice(-HISTORY_LIMIT)
    set({
      painting: next.painting,
      edits: next.edits,
      past: nextPast,
      future: [],
      dirty: !isSaved(next.painting, next.edits),
    })
  }

  /** Moves to a snapshot from the history, keeping a saved edits id and the right picture. */
  const restore = (snap: Snapshot): Pick<EditorState, 'painting' | 'edits' | 'source'> => {
    const editsId = get().painting?.recipe.editsId ?? null
    const painting =
      editsId !== null && snap.painting.recipe.editsId !== editsId
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
      set({
        painting: p,
        source,
        edits,
        step: 'image',
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
      if (!painting) return
      rasters.set(imageId, r)
      const turned = turnedSize(r, painting.recipe.rotation)
      const next: Painting = {
        ...painting,
        recipe: {
          ...painting.recipe,
          source: { imageId, width: r.width, height: r.height },
          crop: centeredCrop(turned.width, turned.height, painting.width, painting.height),
        },
      }
      commit({ painting: next, edits })
      set({ source: r })
    },

    setEdits(layer) {
      const { painting } = get()
      if (!painting) return
      commit({ painting, edits: layer })
    },

    resize(width, height, ppb) {
      const { painting, edits } = get()
      if (!painting) return
      const sizeChanged = width !== painting.width || height !== painting.height
      if (!sizeChanged && ppb === painting.pixelsPerBlock) return
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
      commit({ painting: next, edits: nextEdits })
      set({ selection: null })
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
      set({
        ...restored,
        past: [...past, { painting, edits }].slice(-HISTORY_LIMIT),
        future: rest,
        selection: null,
        dirty: !isSaved(next.painting, next.edits),
      })
    },

    markSaved(p) {
      const { painting, edits, past, future } = get()
      if (!painting) return
      // Snapshots that are the current state point at the saved painting from now on.
      const swap = (s: Snapshot) => (s.painting === painting ? { ...s, painting: p } : s)
      saved = { painting: p, edits }
      lastMerge = null
      set({ painting: p, past: past.map(swap), future: future.map(swap), dirty: false })
    },

    setStep: (step) => set({ step }),
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
