import { ShapeError } from '../domain/errors.ts'
import { exportSet, publish } from '../domain/library.ts'
import type { Assets, Library, Painting } from '../domain/types.ts'
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

export function serverPropertiesLines(sha1: string): string {
  return `resource-pack=<your direct link>\nresource-pack-sha1=${sha1}\nrequire-resource-pack=true`
}

function readme(ns: string, sha1: string): string {
  const datapack = `${ns}-datapack.zip`
  const resources = `${ns}-resources.zip`
  const props = serverPropertiesLines(sha1)
  return [
    'English',
    '=======',
    '',
    `1. Upload ${datapack} to the world/datapacks/ folder of your server.`,
    `2. Upload ${resources} to a host that gives a direct download link.`,
    '3. In server.properties, set these lines (put your direct link in resource-pack):',
    '',
    props,
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
    props,
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
    const source = p.recipe.source ? decodeAsset(assets, p.recipe.source.imageId) : null
    textures[p.id] = encodePng(renderPainting(source, editsFor(p, assets), p))
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

function parseLibrary(bytes: Uint8Array): Library {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (e) {
    throw notALibraryPack(
      `${LIBRARY_ENTRY} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (typeof value !== 'object' || value === null)
    throw notALibraryPack(`${LIBRARY_ENTRY} is empty`)
  const { formatVersion, namespace, name, version, paintings } = value as Record<string, unknown>
  if (typeof formatVersion === 'number' && formatVersion > FORMAT_VERSION) {
    throw new ShapeError(
      'newer-format',
      'This library pack was made by a newer Shape. Open it with the latest version of Shape.',
    )
  }
  if (
    formatVersion !== FORMAT_VERSION ||
    typeof namespace !== 'string' ||
    typeof name !== 'string' ||
    typeof version !== 'number' ||
    !Array.isArray(paintings)
  ) {
    throw notALibraryPack(`${LIBRARY_ENTRY} is missing library fields`)
  }
  return value as Library
}

/** Reads a library pack back into a library and its assets (images and edit layers only). */
export function readLibraryPack(bytes: Uint8Array): { library: Library; assets: Assets } {
  const entries = unzipEntries(bytes)
  const json = entries[LIBRARY_ENTRY]
  if (!json) throw notALibraryPack(`there is no ${LIBRARY_ENTRY} inside`)
  const library = parseLibrary(json)
  const assets: Assets = {}
  for (const [path, data] of Object.entries(entries)) {
    const match = /^(?:images|edits)\/([^/]+)\.png$/.exec(path)
    if (match?.[1]) assets[match[1]] = data
  }
  return { library, assets }
}
