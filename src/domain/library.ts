import { ShapeError } from './errors.ts'
import { makePaintingId } from './ids.ts'
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
    status: 'draft',
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
 * `kept` lists local paintings left untouched; replaced ones appear in neither list.
 */
export function mergeLibraries(local: Library, incoming: Library): MergeResult {
  if (local.namespace !== incoming.namespace) {
    throw new ShapeError(
      'namespace-mismatch',
      `namespace mismatch: ${local.namespace} vs ${incoming.namespace}`,
    )
  }
  const incomingById = new Map(incoming.paintings.map((p) => [p.id, p]))
  const localIds = new Set(local.paintings.map((p) => p.id))
  const kept: Painting[] = []
  const merged = local.paintings.map((p) => {
    const theirs = incomingById.get(p.id)
    if (theirs && theirs.status === 'published' && p.status !== 'published') return theirs
    if (theirs) kept.push(p)
    return p
  })
  const added = incoming.paintings.filter((p) => !localIds.has(p.id))
  return {
    library: {
      ...local,
      version: Math.max(local.version, incoming.version),
      paintings: [...merged, ...added],
    },
    added,
    kept,
  }
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
