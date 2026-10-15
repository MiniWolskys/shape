import { ShapeError } from './errors.ts'
import { makeAssetId, makePaintingId, slugify } from './ids.ts'
import type { Library, Painting, Random, Recipe } from './types.ts'

export function defaultRecipe(): Recipe {
  return {
    source: null,
    crop: { x: 0, y: 0, width: 0, height: 0 },
    rotation: 0,
    flipX: false,
    flipY: false,
    scaling: 'sharp',
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    mcLook: { enabled: false, colors: 16, palette: 'auto', dither: false },
    window: { shape: 'full', glassOpacity: 1 },
    frame: { material: 'dark_oak', thickness: 2 },
    editsId: null,
  }
}

export function createLibrary(name: string, namespace: string): Library {
  return { formatVersion: 1, name, namespace, version: 0, paintings: [] }
}

export function createPainting(
  init: {
    title?: string
    author?: string
    width?: number
    height?: number
    pixelsPerBlock?: number
  },
  now: Date,
  random: Random,
): Painting {
  const title = init.title ?? ''
  const stamp = now.toISOString()
  return {
    id: makePaintingId(title, random),
    title,
    titleColor: 'yellow',
    author: init.author ?? '',
    authorColor: 'gray',
    width: init.width ?? 1,
    height: init.height ?? 1,
    pixelsPerBlock: init.pixelsPerBlock ?? 32,
    status: 'ready',
    createdAt: stamp,
    updatedAt: stamp,
    recipe: defaultRecipe(),
  }
}

export const canDelete = (p: Painting): boolean => p.status !== 'published'
export const canResize = (p: Painting): boolean => p.status !== 'published'

export function updatePainting(
  p: Painting,
  patch: Partial<Omit<Painting, 'id' | 'createdAt' | 'status' | 'publishedIn'>>,
  now: Date,
): Painting {
  const resizes =
    (patch.width !== undefined && patch.width !== p.width) ||
    (patch.height !== undefined && patch.height !== p.height)
  if (resizes && !canResize(p)) {
    throw new ShapeError('published-locked', `Painting ${p.id} is published and cannot be resized`)
  }
  return { ...p, ...patch, updatedAt: now.toISOString() }
}

export function upsertPainting(lib: Library, p: Painting): Library {
  const index = lib.paintings.findIndex((q) => q.id === p.id)
  const paintings =
    index === -1 ? [...lib.paintings, p] : lib.paintings.map((q, i) => (i === index ? p : q))
  return { ...lib, paintings }
}

export function removePainting(lib: Library, id: string): Library {
  const target = lib.paintings.find((p) => p.id === id)
  if (target && !canDelete(target)) {
    throw new ShapeError('published-locked', `Painting ${id} is published and cannot be deleted`)
  }
  return { ...lib, paintings: lib.paintings.filter((p) => p.id !== id) }
}

export interface MergeResult {
  library: Library
  added: Painting[]
  kept: Painting[]
}

/**
 * Merges an incoming library into the local one. Local order is kept, a published incoming copy
 * replaces an unpublished local one in place, and unknown incoming paintings are appended.
 * A painting is known by its id or any of its former ids (I4), on either side, so a draft
 * renamed since a pack was shared never comes back as a copy. `kept` lists local paintings
 * left untouched; replaced ones appear in neither list. An incoming export time is never
 * adopted later than `now` (a friend's clock may run ahead).
 */
export function mergeLibraries(local: Library, incoming: Library, now = new Date()): MergeResult {
  if (local.namespace !== incoming.namespace) {
    throw new ShapeError(
      'namespace-mismatch',
      `namespace mismatch: ${local.namespace} vs ${incoming.namespace}`,
    )
  }
  const localByAnyId = new Map(local.paintings.map((p) => [p.id, p]))
  for (const p of local.paintings) {
    for (const id of p.formerIds ?? []) if (!localByAnyId.has(id)) localByAnyId.set(id, p)
  }
  const theirsFor = new Map<Painting, Painting>()
  const added: Painting[] = []
  for (const theirs of incoming.paintings) {
    const mine = [theirs.id, ...(theirs.formerIds ?? [])]
      .map((id) => localByAnyId.get(id))
      .find((p) => p !== undefined)
    if (!mine) added.push(theirs)
    // Another incoming version of an already matched painting adds nothing.
    else if (!theirsFor.has(mine)) theirsFor.set(mine, theirs)
  }
  const kept: Painting[] = []
  const merged = local.paintings.map((p) => {
    const theirs = theirsFor.get(p)
    if (theirs && theirs.status === 'published' && p.status !== 'published') return theirs
    if (theirs) kept.push(p)
    return p
  })
  // The local export time wins: a later incoming one could hide local changes made since (R15).
  // Without one, the incoming time is adopted only if no local painting is published (a local
  // published painting could carry edits the incoming pack doesn't hold).
  const adopted =
    local.paintings.some((p) => p.status === 'published') || incoming.exportedAt === undefined
      ? undefined
      : notAfter(incoming.exportedAt, now)
  const exportedAt = local.exportedAt ?? adopted
  return {
    library: {
      ...local,
      ...(exportedAt === undefined ? {} : { exportedAt }),
      version: Math.max(local.version, incoming.version),
      paintings: [...merged, ...added],
    },
    added,
    kept,
  }
}

/** The ISO time `time`, or `now` when `time` is later (a clock running ahead). */
export function notAfter(time: string, now: Date): string {
  return Date.parse(time) > now.getTime() ? now.toISOString() : time
}

export function addLoosePaintings(lib: Library, loose: Painting[], random: Random): Library {
  const taken = new Set(lib.paintings.map((p) => p.id))
  const added = loose.map((p) => {
    let id = p.id
    while (taken.has(id)) id = makePaintingId(p.title, random)
    taken.add(id)
    return id === p.id ? p : { ...p, id }
  })
  return { ...lib, paintings: [...lib.paintings, ...added] }
}

export function publish(lib: Library, ids: string[], now: Date): Library {
  const version = lib.version + 1
  const listed = new Set(ids)
  const stamp = now.toISOString()
  return {
    ...lib,
    version,
    paintings: lib.paintings.map((p) =>
      listed.has(p.id) && p.status !== 'published'
        ? { ...p, status: 'published', publishedIn: version, updatedAt: stamp }
        : p,
    ),
  }
}

export function exportSet(lib: Library, ids: string[]): Painting[] {
  const listed = new Set(ids)
  return lib.paintings.filter((p) => p.status === 'published' || listed.has(p.id))
}

export function whatsNew(lib: Library, version: number): Painting[] {
  return lib.paintings.filter((p) => p.publishedIn === version)
}

/** A published painting edited after the last export: the server copy is out of date. */
export function isChanged(p: Painting, lib: Library): boolean {
  return (
    p.status === 'published' &&
    lib.exportedAt !== undefined &&
    Date.parse(p.updatedAt) > Date.parse(lib.exportedAt)
  )
}

/** What a painting's badge says (R16); `changed` needs its library's last export time. */
export type PaintingState = 'draft' | 'ready' | 'changed' | 'published'

export function paintingState(p: Painting, lib: Library | null): PaintingState {
  if (p.status !== 'published') return p.status
  return lib && isChanged(p, lib) ? 'changed' : 'published'
}

/** The paintings Export ticks by itself (R16): ready ones that have a picture. */
export function readyToExport(lib: Library): Painting[] {
  return lib.paintings.filter((p) => p.status === 'ready' && p.recipe.source !== null)
}

/**
 * Paintings that no downloaded library pack holds in their current state (R15): all of them
 * while the library was never exported, else the unpublished and changed ones.
 */
export function unexportedPaintings(lib: Library): Painting[] {
  if (lib.exportedAt === undefined) return lib.paintings
  return lib.paintings.filter((p) => p.status !== 'published' || isChanged(p, lib))
}

/**
 * Sets the title (R17). While unpublished the id follows it: `slugify(title)_<suffix>`, keeping
 * the current three-character suffix (an id without one gets a fresh one) unless another painting in `takenIds` already has that id.
 * Published ids never change. A changed id is added to `formerIds` (I4); they stay after
 * publishing, since an older pack may still hold the painting under one of them.
 */
/** Former ids kept per painting: enough for every rename a shared pack may predate. */
export const MAX_FORMER_IDS = 32

export function retitlePainting(
  p: Painting,
  title: string,
  takenIds: ReadonlySet<string>,
  now: Date,
  random: Random,
): Painting {
  const titled = { ...p, title, updatedAt: now.toISOString() }
  if (p.status === 'published') return titled
  const suffix = /_([a-z0-9]{3})$/.exec(p.id)?.[1]
  let id = suffix ? `${slugify(title)}_${suffix}` : makePaintingId(title, random)
  while (id !== p.id && takenIds.has(id)) id = makePaintingId(title, random)
  if (id === p.id) return titled
  // Packs shared before keep naming it by its old id: merges recognise it by that (I4).
  const former = [...(p.formerIds ?? []).filter((f) => f !== id && f !== p.id), p.id]
  return { ...titled, id, formerIds: former.slice(-MAX_FORMER_IDS) }
}

/** Returns the list with `p` inserted right after the painting `afterId` (or at the end). */
export function insertAfter(paintings: Painting[], afterId: string, p: Painting): Painting[] {
  const index = paintings.findIndex((q) => q.id === afterId)
  if (index === -1) return [...paintings, p]
  return [...paintings.slice(0, index + 1), p, ...paintings.slice(index + 1)]
}

export interface NewCopy {
  painting: Painting
  /** Old asset id → new asset id, for every asset the copy needs (edit masks included). */
  assetIds: Record<string, string>
}

/**
 * Makes an independent, unpublished, ready copy of a painting: a fresh id from `title`, fresh
 * asset ids (so editing one never changes the other) and new timestamps. The caller copies the
 * asset bytes along `assetIds`.
 */
export function copyAsNew(
  p: Painting,
  opts: {
    title: string
    takenIds: ReadonlySet<string>
    takenAssetIds: ReadonlySet<string>
    now: Date
    random: Random
  },
): NewCopy {
  const { title, takenIds, takenAssetIds, now, random } = opts
  const used = new Set(takenAssetIds)
  const freshAsset = (avoidMask: boolean) => {
    let id = makeAssetId(random)
    while (used.has(id) || (avoidMask && used.has(`${id}.mask`))) id = makeAssetId(random)
    used.add(id)
    return id
  }
  const assetIds: Record<string, string> = {}
  const recipe = { ...p.recipe }
  if (recipe.source) {
    const imageId = freshAsset(false)
    assetIds[recipe.source.imageId] = imageId
    recipe.source = { ...recipe.source, imageId }
  }
  if (recipe.editsId) {
    const editsId = freshAsset(true)
    assetIds[recipe.editsId] = editsId
    assetIds[`${recipe.editsId}.mask`] = `${editsId}.mask`
    recipe.editsId = editsId
  }
  let id = makePaintingId(title, random)
  while (takenIds.has(id)) id = makePaintingId(title, random)
  const stamp = now.toISOString()
  const painting: Painting = {
    ...p,
    id,
    title,
    status: 'ready',
    createdAt: stamp,
    updatedAt: stamp,
    recipe,
  }
  delete painting.publishedIn
  // A copy is a new painting: no pack ever named it by the original's ids.
  delete painting.formerIds
  return { painting, assetIds }
}
