import { describe, expect, it } from 'vitest'
import { createLibrary, createPainting, upsertPainting } from '../domain/library.ts'
import type { Library } from '../domain/types.ts'
import { buildDatapackFiles } from './datapack.ts'
import { buildResourcePackFiles } from './resourcepack.ts'

const now = new Date('2026-10-15T12:00:00Z')
const json = (bytes: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(bytes))

function library(): Library {
  const a = createPainting({ title: 'Sunset', author: 'Sam', width: 2, height: 1 }, now, () => 0.1)
  const b = {
    ...createPainting({ title: 'Moon', author: 'Alex', width: 1, height: 3 }, now, () => 0.9),
    titleColor: 'aqua' as const,
    authorColor: 'white' as const,
  }
  return upsertPainting(upsertPainting(createLibrary('Our paintings', 'ourpaintings'), a), b)
}

describe('datapack', () => {
  it('writes pack.mcmeta, one variant per painting and the placeable tag in library order', () => {
    const lib = library()
    const [a, b] = lib.paintings
    if (!a || !b) throw new Error('sample needs two paintings')
    const files = buildDatapackFiles(lib, lib.paintings)
    expect(Object.keys(files).sort()).toEqual(
      [
        'pack.mcmeta',
        `data/ourpaintings/painting_variant/${a.id}.json`,
        `data/ourpaintings/painting_variant/${b.id}.json`,
        'data/minecraft/tags/painting_variant/placeable.json',
      ].sort(),
    )
    expect(json(files['pack.mcmeta'])).toEqual({
      pack: { description: 'Our paintings (Shape, data)', min_format: 121, max_format: 121 },
    })
    expect(json(files[`data/ourpaintings/painting_variant/${b.id}.json`])).toEqual({
      asset_id: `ourpaintings:${b.id}`,
      width: 1,
      height: 3,
      title: { text: 'Moon', color: 'aqua' },
      author: { text: 'Alex', color: 'white' },
    })
    expect(json(files['data/minecraft/tags/painting_variant/placeable.json'])).toEqual({
      replace: false,
      values: [`ourpaintings:${a.id}`, `ourpaintings:${b.id}`],
    })
  })

  it('formats JSON with two spaces and a trailing newline', () => {
    const lib = library()
    const text = new TextDecoder().decode(buildDatapackFiles(lib, lib.paintings)['pack.mcmeta'])
    expect(text).toBe(
      '{\n  "pack": {\n    "description": "Our paintings (Shape, data)",\n    "min_format": 121,\n    "max_format": 121\n  }\n}\n',
    )
  })
})

describe('resource pack', () => {
  it('writes pack.mcmeta and one texture per painting', () => {
    const lib = library()
    const png = new Uint8Array([1, 2, 3])
    const files = buildResourcePackFiles(lib, { sunset_abc: png })
    expect(Object.keys(files).sort()).toEqual([
      'assets/ourpaintings/textures/painting/sunset_abc.png',
      'pack.mcmeta',
    ])
    expect(files['assets/ourpaintings/textures/painting/sunset_abc.png']).toBe(png)
    expect(json(files['pack.mcmeta'])).toEqual({
      pack: { description: 'Our paintings (Shape, textures)', min_format: 97, max_format: [97, 1] },
    })
  })
})
