import { describe, expect, it } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../domain/library.ts'
import dataMcmeta from './__fixtures__/mc-26.3/datapack.pack.mcmeta.json?raw'
import variantJson from './__fixtures__/mc-26.3/painting_variant.window.json?raw'
import placeableJson from './__fixtures__/mc-26.3/placeable.json?raw'
import resourcesMcmeta from './__fixtures__/mc-26.3/resourcepack.pack.mcmeta.json?raw'
import { buildDatapackFiles } from './datapack.ts'
import { buildResourcePackFiles } from './resourcepack.ts'

// The fixtures are JSON files copied from the Minecraft 26.3 test packs that were checked in game.
const now = new Date('2026-10-15T12:00:00Z')
const parse = (bytes: Uint8Array | undefined): unknown =>
  JSON.parse(new TextDecoder().decode(bytes))
const ASSET_ID = /^[a-z0-9_.-]+:[a-z0-9_]+$/

/** Same keys at every level and the same JSON type for every leaf value. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shapeOf(v)]),
    )
  }
  return value === null ? 'null' : typeof value
}

function formats(mcmeta: unknown): unknown {
  const { min_format, max_format } = (mcmeta as { pack: Record<string, unknown> }).pack
  return { min_format, max_format }
}

function generated() {
  const p = createPainting({ title: 'Sunset', author: 'Sam', width: 2, height: 2 }, now, () => 0.3)
  const lib = upsertPainting(createLibrary('Our paintings', 'ourpaintings'), p)
  return {
    data: buildDatapackFiles(lib, lib.paintings),
    resources: buildResourcePackFiles(lib, { [p.id]: new Uint8Array([1]) }),
    id: p.id,
  }
}

describe('generated packs match the Minecraft 26.3 reference packs', () => {
  it('declares the same pack formats in the same pack.mcmeta shape', () => {
    const { data, resources } = generated()
    const oursData = parse(data['pack.mcmeta'])
    const oursResources = parse(resources['pack.mcmeta'])
    expect(formats(oursData)).toEqual(formats(JSON.parse(dataMcmeta)))
    expect(formats(oursResources)).toEqual(formats(JSON.parse(resourcesMcmeta)))
    expect(shapeOf(oursData)).toEqual(shapeOf(JSON.parse(dataMcmeta)))
    expect(shapeOf(oursResources)).toEqual(shapeOf(JSON.parse(resourcesMcmeta)))
  })

  it('writes painting variants with the reference keys and value types', () => {
    const { data, id } = generated()
    const ours = parse(data[`data/ourpaintings/painting_variant/${id}.json`])
    expect(shapeOf(ours)).toEqual(shapeOf(JSON.parse(variantJson)))
  })

  it('writes the placeable tag with the reference keys and value types', () => {
    const { data } = generated()
    const ours = parse(data['data/minecraft/tags/painting_variant/placeable.json']) as {
      values: unknown[]
    }
    const reference = JSON.parse(placeableJson) as { values: unknown[] }
    expect(shapeOf({ ...ours, values: [] })).toEqual(shapeOf({ ...reference, values: [] }))
    for (const values of [ours.values, reference.values]) {
      expect(values.length).toBeGreaterThan(0)
      expect(values.every((v) => typeof v === 'string' && ASSET_ID.test(v))).toBe(true)
    }
  })
})
