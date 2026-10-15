import { ShapeError } from '../domain/errors.ts'
import { isValidAssetId, isValidNamespace } from '../domain/ids.ts'
import { MAX_FORMER_IDS, exportSet, publish } from '../domain/library.ts'
import {
  FRAME_MATERIAL_IDS,
  MC_COLORS,
  SHAPE_IDS,
  type Assets,
  type Library,
  type Painting,
} from '../domain/types.ts'
import type { EditLayer } from '../imaging/edits.ts'
import { renderPainting } from '../imaging/pipeline.ts'
import type { Raster } from '../imaging/raster.ts'
import { buildDatapackFiles } from './datapack.ts'
import { jsonBytes } from './formats.ts'
import { decodeEditLayer, decodePng, encodePng } from './png.ts'
import { buildResourcePackFiles } from './resourcepack.ts'
import { sha1Hex } from './sha1.ts'
import { unzipEntries, zipDeterministic } from './zip.ts'

const LIBRARY_ENTRY = 'shape-library.json'
const FORMAT_VERSION = 1

export interface LibraryPackResult {
  bytes: Uint8Array
  fileName: string
  sha1: string
  library: Library
}

/** The server.properties lines; `link` stands in for the resource pack's download link. */
export function serverPropertiesLines(sha1: string, link = '<your direct link>'): string {
  return `resource-pack=${link}\nresource-pack-sha1=${sha1}\nrequire-resource-pack=true`
}

function readme(ns: string, sha1: string): string {
  const datapack = `${ns}-datapack.zip`
  const resources = `${ns}-resources.zip`
  return [
    'English',
    '=======',
    '',
    '0. Every player needs the Transparent Paintings mod to see through the windows. Without it, they see the frame color.',
    `1. Unzip the library pack, then upload server/${datapack} to the world/datapacks/ folder of your server.`,
    `2. Upload server/${resources} to a host that gives a direct link to the file (not to a page).`,
    '3. In server.properties, set these lines (put your direct link in resource-pack):',
    '',
    serverPropertiesLines(sha1),
    '',
    '4. Restart the server. /reload is not enough.',
    '',
    'Never delete or rename a published painting: paintings already hanging in your world would break.',
    '',
    '',
    'Français',
    '========',
    '',
    '0. Chaque joueur a besoin du mod Transparent Paintings pour voir à travers les fenêtres. Sans lui, il voit la couleur du cadre.',
    `1. Décompressez le pack de bibliothèque, puis envoyez server/${datapack} dans le dossier world/datapacks/ de votre serveur.`,
    `2. Mettez server/${resources} chez un hébergeur qui donne un lien direct vers le fichier (pas vers une page).`,
    '3. Dans server.properties, mettez ces lignes (votre lien direct dans resource-pack) :',
    '',
    serverPropertiesLines(sha1, '<votre lien direct>'),
    '',
    '4. Redémarrez le serveur. /reload ne suffit pas.',
    '',
    'Ne supprimez ni ne renommez jamais un tableau publié : les tableaux déjà accrochés dans votre monde seraient cassés.',
    '',
  ].join('\n')
}

/** An export-failed error naming the painting, so the player knows which one to open. */
function paintingFailed(p: Painting, what: string, cause: unknown): ShapeError {
  const why = cause instanceof Error ? cause.message : String(cause)
  return new ShapeError(
    'export-failed',
    `The ${what} for painting "${p.title}" (${p.id}): ${why}. Open it, choose the picture again, then export.`,
    p.title.trim() || p.id,
  )
}

const assetOf = (assets: Assets, key: string): Uint8Array | undefined =>
  Object.hasOwn(assets, key) ? assets[key] : undefined

function decodeAsset(assets: Assets, key: string): Raster | null {
  const bytes = assetOf(assets, key)
  return bytes ? decodePng(bytes) : null
}

function editsFor(p: Painting, assets: Assets): EditLayer | null {
  const id = p.recipe.editsId
  if (id === null) return null
  const values = assetOf(assets, id)
  const mask = assetOf(assets, `${id}.mask`)
  return values && mask ? decodeEditLayer(values, mask) : null
}

/** Asset keys a painting needs, with their path inside the library pack. */
function assetEntries(p: Painting): [key: string, path: string][] {
  const out: [string, string][] = []
  const image = p.recipe.source?.imageId
  if (image) out.push([image, `images/${image}.png`])
  const edits = p.recipe.editsId
  if (edits) out.push([edits, `edits/${edits}.png`], [`${edits}.mask`, `edits/${edits}.mask.png`])
  return out
}

/**
 * Publishes the selection and builds `<namespace>-v<version>.zip`: the library JSON, its source
 * images and edit layers, the rendered textures, and the two server packs with the resource
 * pack's SHA1 and a README. `onProgress(done, total)` is called as each painting starts
 * rendering (done counts from 1).
 *
 * With `again`, nothing is published and the version stays: the library's current version is
 * built once more, so an unchanged library gives the very same bytes and SHA1 (C5). A `backup`
 * is built the same way but named `<namespace>-v<version>-backup.zip`: it also holds paintings
 * changed or added since that version, so it is not the file that version was (R35).
 */
export async function writeLibraryPack(
  lib: Library,
  selectedIds: string[],
  assets: Assets,
  now: Date,
  onProgress?: (done: number, total: number) => void,
  options: { again?: boolean; backup?: boolean } = {},
): Promise<LibraryPackResult> {
  const library =
    options.again || options.backup
      ? lib
      : { ...publish(lib, selectedIds, now), exportedAt: now.toISOString() }
  const paintings = exportSet(library, selectedIds)
  const ns = library.namespace

  const textures: Record<string, Uint8Array> = {}
  for (const [index, p] of paintings.entries()) {
    onProgress?.(index + 1, paintings.length)
    let source: Raster | null
    let edits: EditLayer | null
    try {
      source = p.recipe.source ? decodeAsset(assets, p.recipe.source.imageId) : null
      edits = editsFor(p, assets)
    } catch (e) {
      throw paintingFailed(p, 'stored picture or pixel edits are damaged', e)
    }
    let texture: Raster
    try {
      texture = renderPainting(source, edits, p)
    } catch (e) {
      // Never a library that can't be exported for good: the player learns which painting it is.
      throw paintingFailed(p, 'recipe cannot be rendered', e)
    }
    textures[p.id] = encodePng(texture)
  }
  const datapack = zipDeterministic(buildDatapackFiles(library, paintings))
  const resources = zipDeterministic(buildResourcePackFiles(library, textures))
  const sha1 = await sha1Hex(resources)

  const entries: Record<string, Uint8Array> = {
    [LIBRARY_ENTRY]: jsonBytes(library),
    [`server/${ns}-datapack.zip`]: datapack,
    [`server/${ns}-resources.zip`]: resources,
    'server/sha1.txt': new TextEncoder().encode(sha1 + '\n'),
    'server/README.txt': new TextEncoder().encode(readme(ns, sha1)),
  }
  for (const p of library.paintings) {
    for (const [key, path] of assetEntries(p)) {
      const bytes = assets[key]
      if (bytes) entries[path] = bytes
    }
  }
  for (const [id, png] of Object.entries(textures)) entries[`textures/${id}.png`] = png

  return {
    bytes: zipDeterministic(entries),
    fileName: `${ns}-v${library.version}${options.backup ? '-backup' : ''}.zip`,
    sha1,
    library,
  }
}

function notALibraryPack(why: string): ShapeError {
  return new ShapeError('not-a-library-pack', `This file is not a Shape library pack (${why}).`)
}

const PAINTING_ID = /^[a-z0-9_]+$/
const STATUSES = ['draft', 'ready', 'published']
const ROTATIONS = [0, 90, 180, 270]
const SCALINGS = ['sharp', 'smooth']
const PALETTES = ['auto', 'blocks']
const CROP_FIELDS = ['x', 'y', 'width', 'height']
const ADJUST_FIELDS = ['brightness', 'contrast', 'saturation']

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIntIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isNumberIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isOneOf = (v: unknown, values: readonly string[]) =>
  typeof v === 'string' && values.includes(v)
const isBoolean = (v: unknown) => typeof v === 'boolean'
/** An ISO 8601 UTC timestamp exactly as `Date.toISOString` writes it (no impossible dates). */
const isIsoTime = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
const isAssetId = (v: unknown) => typeof v === 'string' && isValidAssetId(v)
const MAX = Number.MAX_SAFE_INTEGER

/**
 * Returns the first problem with a recipe, or null when the pipeline can render it: every field
 * is checked against the range the editor can produce.
 */
function recipeProblem(r: unknown, maxThickness: number): string | null {
  if (!isObject(r)) return 'has no recipe'
  const { source, crop, adjust, mcLook, window, frame } = r
  if (
    source !== null &&
    (!isObject(source) ||
      !isAssetId(source.imageId) ||
      !isIntIn(source.width, 1, MAX) ||
      !isIntIn(source.height, 1, MAX))
  ) {
    return 'has an invalid source'
  }
  if (!isObject(crop) || !CROP_FIELDS.every((k) => isNumberIn(crop[k], 0, MAX))) {
    return 'has an invalid crop'
  }
  if (typeof r.rotation !== 'number' || !ROTATIONS.includes(r.rotation)) {
    return 'has an invalid rotation'
  }
  if (!isBoolean(r.flipX)) return 'has an invalid flipX'
  if (!isBoolean(r.flipY)) return 'has an invalid flipY'
  if (!isOneOf(r.scaling, SCALINGS)) return 'has an invalid scaling'
  if (!isObject(adjust) || !ADJUST_FIELDS.every((k) => isNumberIn(adjust[k], -100, 100))) {
    return 'has an invalid adjust'
  }
  if (
    !isObject(mcLook) ||
    !isBoolean(mcLook.enabled) ||
    !isIntIn(mcLook.colors, 2, 64) ||
    !isOneOf(mcLook.palette, PALETTES) ||
    !isBoolean(mcLook.dither)
  ) {
    return 'has an invalid mcLook'
  }
  if (!isObject(window) || !isOneOf(window.shape, SHAPE_IDS)) return 'has an invalid shape'
  if (!isNumberIn(window.glassOpacity, 0, 1)) return 'has an invalid glassOpacity'
  if (!isObject(frame) || !isOneOf(frame.material, FRAME_MATERIAL_IDS)) {
    return 'has an invalid frame'
  }
  if (!isIntIn(frame.thickness, 0, maxThickness)) return 'has an invalid frame thickness'
  if (r.editsId !== null && !isAssetId(r.editsId)) return 'has an invalid editsId'
  return null
}

/** Returns the first problem with a painting entry, or null when it can be used safely. */
function paintingProblem(p: unknown, version: number): string | null {
  if (!isObject(p)) return 'is not an object'
  if (typeof p.id !== 'string' || !PAINTING_ID.test(p.id)) return 'has an invalid id'
  if (typeof p.title !== 'string') return 'has no title'
  if (typeof p.author !== 'string') return 'has no author'
  if (!isOneOf(p.titleColor, MC_COLORS)) return 'has an invalid titleColor'
  if (!isOneOf(p.authorColor, MC_COLORS)) return 'has an invalid authorColor'
  if (!isIntIn(p.width, 1, 16)) return 'has an invalid width'
  if (!isIntIn(p.height, 1, 16)) return 'has an invalid height'
  if (!isIntIn(p.pixelsPerBlock, 1, 64)) return 'has an invalid pixelsPerBlock'
  if (!isOneOf(p.status, STATUSES)) return 'has an invalid status'
  // A published painting names the version that published it; no other painting names one.
  const published = p.status === 'published'
  if (published ? !isIntIn(p.publishedIn, 1, version) : p.publishedIn !== undefined) {
    return 'has an invalid publishedIn'
  }
  if (
    p.formerIds !== undefined &&
    (!Array.isArray(p.formerIds) ||
      p.formerIds.length > MAX_FORMER_IDS ||
      !p.formerIds.every((id) => typeof id === 'string' && PAINTING_ID.test(id)))
  ) {
    return 'has invalid formerIds'
  }
  if (!isIsoTime(p.createdAt)) return 'has an invalid createdAt'
  if (!isIsoTime(p.updatedAt)) return 'has an invalid updatedAt'
  // A resize scales the thickness with the pixels per block (R4): up to half the shorter side.
  const shorter = Math.min(p.width as number, p.height as number) * (p.pixelsPerBlock as number)
  return recipeProblem(p.recipe, Math.floor(shorter / 2))
}

function parseLibrary(bytes: Uint8Array): Library {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    throw notALibraryPack(
      `${LIBRARY_ENTRY} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!isObject(value)) throw notALibraryPack(`${LIBRARY_ENTRY} is empty`)
  const { formatVersion, namespace, name, version, exportedAt, paintings } = value
  if (typeof formatVersion === 'number' && formatVersion > FORMAT_VERSION) {
    throw new ShapeError(
      'newer-format',
      'This library pack was made by a newer Shape. Open it with the latest version of Shape.',
    )
  }
  if (formatVersion !== FORMAT_VERSION || typeof name !== 'string' || !Array.isArray(paintings)) {
    throw notALibraryPack(`${LIBRARY_ENTRY} is missing library fields`)
  }
  if (typeof version !== 'number' || !isIntIn(version, 0, MAX)) {
    throw notALibraryPack(`${LIBRARY_ENTRY} has an invalid version`)
  }
  if (typeof namespace !== 'string' || !isValidNamespace(namespace)) {
    throw notALibraryPack(`${LIBRARY_ENTRY} has an invalid namespace`)
  }
  if (exportedAt !== undefined && !isIsoTime(exportedAt)) {
    throw notALibraryPack(`${LIBRARY_ENTRY} has an invalid exportedAt`)
  }
  const seen = new Set<string>()
  paintings.forEach((p: unknown, i) => {
    const problem = paintingProblem(p, version)
    if (problem) throw notALibraryPack(`painting ${i} ${problem}`)
    const id = (p as Json).id as string
    if (seen.has(id)) throw notALibraryPack(`painting ${i} repeats the id ${id}`)
    seen.add(id)
  })
  return value as unknown as Library
}

/** Reads a library pack back into a library and its assets (images and edit layers only). */
export function readLibraryPack(bytes: Uint8Array): { library: Library; assets: Assets } {
  // Only what a library pack is read from: the textures and server packs are never inflated.
  const entries = unzipEntries(bytes, {
    keep: (name) => name === LIBRARY_ENTRY || /^(?:images|edits)\/[^/]+\.png$/.test(name),
  })
  const json = entries[LIBRARY_ENTRY]
  if (!json) throw notALibraryPack(`there is no ${LIBRARY_ENTRY} inside`)
  const library = parseLibrary(json)
  // A Map, so names like "constructor" or "__proto__" are plain keys.
  const assets = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(entries)) {
    const key = /^(?:images|edits)\/([^/]+)\.png$/.exec(path)?.[1]
    // No painting can name an object's own property (isValidAssetId): such a file is unused.
    if (!key || !isValidAssetId(key.replace(/\.mask$/, ''))) continue
    if (assets.has(key)) throw notALibraryPack(`two files share the asset name ${key}`)
    assets.set(key, data)
  }
  return { library, assets: Object.fromEntries(assets) }
}
