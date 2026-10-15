import { ShapeError } from '../domain/errors.ts'
import { isValidNamespace } from '../domain/ids.ts'
import { exportSet, publish } from '../domain/library.ts'
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
    `1. Upload ${datapack} to the world/datapacks/ folder of your server.`,
    `2. Upload ${resources} to a host that gives a direct download link.`,
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
    `1. Envoyez ${datapack} dans le dossier world/datapacks/ de votre serveur.`,
    `2. Envoyez ${resources} sur un hébergeur qui donne un lien de téléchargement direct.`,
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

function decodeAsset(assets: Assets, key: string): Raster | null {
  const bytes = assets[key]
  return bytes ? decodePng(bytes) : null
}

function editsFor(p: Painting, assets: Assets): EditLayer | null {
  const id = p.recipe.editsId
  if (id === null) return null
  const values = assets[id]
  const mask = assets[`${id}.mask`]
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
 * pack's SHA1 and a README.
 */
export async function writeLibraryPack(
  lib: Library,
  selectedIds: string[],
  assets: Assets,
  now: Date,
): Promise<LibraryPackResult> {
  const library = publish(lib, selectedIds, now)
  const paintings = exportSet(library, selectedIds)
  const ns = library.namespace

  const textures: Record<string, Uint8Array> = {}
  for (const p of paintings) {
    let source: Raster | null
    let edits: EditLayer | null
    try {
      source = p.recipe.source ? decodeAsset(assets, p.recipe.source.imageId) : null
      edits = editsFor(p, assets)
    } catch (e) {
      throw new ShapeError(
        'export-failed',
        `The stored picture or pixel edits of painting "${p.title}" (${p.id}) are damaged: ${e instanceof Error ? e.message : String(e)} Choose the picture again, then export.`,
      )
    }
    textures[p.id] = encodePng(renderPainting(source, edits, p))
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
    fileName: `${ns}-v${library.version}.zip`,
    sha1,
    library,
  }
}

function notALibraryPack(why: string): ShapeError {
  return new ShapeError('not-a-library-pack', `This file is not a Shape library pack (${why}).`)
}

const PAINTING_ID = /^[a-z0-9_]+$/
/** Asset ids become zip paths, so only plain file-name characters are accepted. */
const ASSET_ID = /^[A-Za-z0-9_-]+$/
const STATUSES = ['draft', 'ready', 'published']

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIntIn = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isOneOf = (v: unknown, values: readonly string[]) =>
  typeof v === 'string' && values.includes(v)

/** Returns the first problem with a painting entry, or null when it can be used safely. */
function paintingProblem(p: unknown): string | null {
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
  const r = p.recipe
  if (!isObject(r)) return 'has no recipe'
  if (!isObject(r.window) || !isOneOf(r.window.shape, SHAPE_IDS)) return 'has an invalid shape'
  if (!isObject(r.frame) || !isOneOf(r.frame.material, FRAME_MATERIAL_IDS)) {
    return 'has an invalid frame'
  }
  if (r.editsId !== null && (typeof r.editsId !== 'string' || !ASSET_ID.test(r.editsId))) {
    return 'has an invalid editsId'
  }
  if (
    r.source !== null &&
    (!isObject(r.source) ||
      typeof r.source.imageId !== 'string' ||
      !ASSET_ID.test(r.source.imageId))
  ) {
    return 'has an invalid source'
  }
  return null
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
  const { formatVersion, namespace, name, version, paintings } = value
  if (typeof formatVersion === 'number' && formatVersion > FORMAT_VERSION) {
    throw new ShapeError(
      'newer-format',
      'This library pack was made by a newer Shape. Open it with the latest version of Shape.',
    )
  }
  if (
    formatVersion !== FORMAT_VERSION ||
    typeof name !== 'string' ||
    typeof version !== 'number' ||
    !Array.isArray(paintings)
  ) {
    throw notALibraryPack(`${LIBRARY_ENTRY} is missing library fields`)
  }
  if (typeof namespace !== 'string' || !isValidNamespace(namespace)) {
    throw notALibraryPack(`${LIBRARY_ENTRY} has an invalid namespace`)
  }
  const seen = new Set<string>()
  paintings.forEach((p: unknown, i) => {
    const problem = paintingProblem(p)
    if (problem) throw notALibraryPack(`painting ${i} ${problem}`)
    const id = (p as Json).id as string
    if (seen.has(id)) throw notALibraryPack(`painting ${i} repeats the id ${id}`)
    seen.add(id)
  })
  return value as unknown as Library
}

/** Reads a library pack back into a library and its assets (images and edit layers only). */
export function readLibraryPack(bytes: Uint8Array): { library: Library; assets: Assets } {
  const entries = unzipEntries(bytes)
  const json = entries[LIBRARY_ENTRY]
  if (!json) throw notALibraryPack(`there is no ${LIBRARY_ENTRY} inside`)
  const library = parseLibrary(json)
  // A Map, so names like "constructor" or "__proto__" are plain keys.
  const assets = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(entries)) {
    const key = /^(?:images|edits)\/([^/]+)\.png$/.exec(path)?.[1]
    if (!key) continue
    if (assets.has(key)) throw notALibraryPack(`two files share the asset name ${key}`)
    assets.set(key, data)
  }
  return { library, assets: Object.fromEntries(assets) }
}
