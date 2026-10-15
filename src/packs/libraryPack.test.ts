import { describe, expect, it } from 'vitest'
import { ShapeError } from '../domain/errors.ts'
import { createLibrary, createPainting, upsertPainting } from '../domain/library.ts'
import { createEditLayer } from '../imaging/edits.ts'
import { createRaster, getPixel } from '../imaging/raster.ts'
import { decodePng, encodeEditLayer, encodePng } from './png.ts'
import { readLibraryPack, serverPropertiesLines, writeLibraryPack } from './libraryPack.ts'
import { unzipEntries, zipDeterministic } from './zip.ts'

const now = new Date('2026-10-15T12:00:00Z')
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

function sample() {
  const p0 = createPainting(
    { title: 'Sunset', author: 'Sam', width: 2, height: 1, pixelsPerBlock: 16 },
    now,
    () => 0.3,
  )
  const p = { ...p0, recipe: { ...p0.recipe, source: { imageId: 'img1', width: 8, height: 4 } } }
  return {
    lib: upsertPainting(createLibrary('Our paintings', 'ourpaintings'), p),
    p,
    assets: { img1: encodePng(createRaster(8, 4, [255, 0, 0, 255])) },
  }
}

describe('library pack', () => {
  it('builds a backup of the current version under its own name (R35)', async () => {
    const { lib, p, assets } = sample()
    const first = await writeLibraryPack(lib, [p.id], assets, now)
    const draft = { ...p, id: `${p.id}_d`, title: 'Draft', status: 'draft' as const }
    const withDraft = upsertPainting(first.library, draft)
    const backup = await writeLibraryPack(withDraft, [], assets, now, undefined, { backup: true })
    expect(backup.fileName).toBe('ourpaintings-v1-backup.zip')
    expect(backup.library).toEqual(withDraft)
    expect(backup.sha1).toBe(first.sha1)
  })

  it('downloads the last version again: same bytes, no publish, no new version (C5)', async () => {
    const { lib, p, assets } = sample()
    const first = await writeLibraryPack(lib, [p.id], assets, now)
    const later = new Date('2026-10-16T09:00:00Z')
    const again = await writeLibraryPack(first.library, [], assets, later, undefined, {
      again: true,
    })
    expect(again.fileName).toBe('ourpaintings-v1.zip')
    expect(again.library).toEqual(first.library)
    expect(again.sha1).toBe(first.sha1)
    expect(again.bytes).toEqual(first.bytes)
  })

  it('reports each painting as it starts rendering', async () => {
    const { lib, p, assets } = sample()
    const second = { ...p, id: `${p.id}_b`, title: 'Dawn' }
    const progress: Array<[number, number]> = []
    await writeLibraryPack(upsertPainting(lib, second), [p.id, second.id], assets, now, (d, t) =>
      progress.push([d, t]),
    )
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('contains the library, both packs and the sha1', async () => {
    const { lib, p, assets } = sample()
    const out = await writeLibraryPack(lib, [p.id], assets, now)
    expect(out.fileName).toBe('ourpaintings-v1.zip')
    const entries = unzipEntries(out.bytes)
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'shape-library.json',
        'images/img1.png',
        `textures/${p.id}.png`,
        'server/ourpaintings-datapack.zip',
        'server/ourpaintings-resources.zip',
        'server/sha1.txt',
        'server/README.txt',
      ]),
    )
    const data = unzipEntries(entries['server/ourpaintings-datapack.zip']!)
    const variant = JSON.parse(
      new TextDecoder().decode(data[`data/ourpaintings/painting_variant/${p.id}.json`]!),
    )
    expect(variant).toEqual({
      asset_id: `ourpaintings:${p.id}`,
      width: 2,
      height: 1,
      title: { text: 'Sunset', color: 'yellow' },
      author: { text: 'Sam', color: 'gray' },
    })
    expect(JSON.parse(new TextDecoder().decode(data['pack.mcmeta']!)).pack).toMatchObject({
      min_format: 121,
      max_format: 121,
    })
    expect(new TextDecoder().decode(entries['server/sha1.txt']!).trim()).toBe(out.sha1)
    expect(out.sha1).toMatch(/^[0-9a-f]{40}$/)
  })
  it('round-trips', async () => {
    const { lib, p, assets } = sample()
    const out = await writeLibraryPack(lib, [p.id], assets, now)
    const back = readLibraryPack(out.bytes)
    expect(back.library).toEqual(out.library)
    expect(back.assets.img1).toEqual(assets.img1)
  })
  it('gives the same sha1 for the same content', async () => {
    const { lib, p, assets } = sample()
    const a = await writeLibraryPack(lib, [p.id], assets, now)
    const b = await writeLibraryPack(lib, [p.id], assets, new Date('2027-01-01T00:00:00Z'))
    expect(b.sha1).toBe(a.sha1)
  })
  it('rejects a random zip', () => {
    expect(() => readLibraryPack(zipDeterministic({ 'hello.txt': new Uint8Array([1]) }))).toThrow(
      /library/i,
    )
  })
  it('rejects a newer format', () => {
    const json = new TextEncoder().encode(JSON.stringify({ formatVersion: 2 }))
    expect(() => readLibraryPack(zipDeterministic({ 'shape-library.json': json }))).toThrow(
      /newer/i,
    )
  })
  it('rejects bytes that are not a zip', () =>
    expect(() => readLibraryPack(new Uint8Array([1, 2, 3]))).toThrow())

  it('publishes the selection and names the file after the new version', async () => {
    const { lib, p, assets } = sample()
    const out = await writeLibraryPack({ ...lib, version: 4 }, [p.id], assets, now)
    expect(out.fileName).toBe('ourpaintings-v5.zip')
    expect(out.library.version).toBe(5)
    expect(out.library.paintings[0]).toMatchObject({ status: 'published', publishedIn: 5 })
    const stored = JSON.parse(text(unzipEntries(out.bytes)['shape-library.json']))
    expect(stored).toEqual(out.library)
  })

  it('records when the pack was exported, in the library and its JSON', async () => {
    const { lib, p, assets } = sample()
    const out = await writeLibraryPack(lib, [p.id], assets, now)
    expect(out.library.exportedAt).toBe(now.toISOString())
    expect(readLibraryPack(out.bytes).library.exportedAt).toBe(now.toISOString())
  })

  it('renders the texture at the painting size and puts the same PNG in the resource pack', async () => {
    const { lib, p, assets } = sample()
    const entries = unzipEntries((await writeLibraryPack(lib, [p.id], assets, now)).bytes)
    const texture = entries[`textures/${p.id}.png`]
    const raster = decodePng(texture ?? new Uint8Array())
    expect([raster.width, raster.height]).toEqual([32, 16])
    expect(getPixel(raster, 16, 8)).toEqual([255, 0, 0, 255])
    const resources = unzipEntries(entries['server/ourpaintings-resources.zip'] ?? new Uint8Array())
    expect(resources[`assets/ourpaintings/textures/painting/${p.id}.png`]).toEqual(texture)
    expect(Object.keys(resources).sort()).toEqual([
      `assets/ourpaintings/textures/painting/${p.id}.png`,
      'pack.mcmeta',
    ])
  })

  it('applies the edit layer and stores it, then imports it under the same asset keys', async () => {
    const { lib, p, assets } = sample()
    const layer = createEditLayer(32, 16)
    const at = 8 * 32 + 16
    layer.mask[at] = 1
    layer.values.data.set([0, 0, 255, 255], at * 4)
    const stored = encodeEditLayer(layer)
    const edited = { ...p, recipe: { ...p.recipe, editsId: 'ed1' } }
    const all = { ...assets, ed1: stored.values, 'ed1.mask': stored.mask }
    const out = await writeLibraryPack(upsertPainting(lib, edited), [p.id], all, now)
    const entries = unzipEntries(out.bytes)
    expect(entries['edits/ed1.png']).toEqual(stored.values)
    expect(entries['edits/ed1.mask.png']).toEqual(stored.mask)
    const raster = decodePng(entries[`textures/${p.id}.png`] ?? new Uint8Array())
    expect(getPixel(raster, 16, 8)).toEqual([0, 0, 255, 255])
    const back = readLibraryPack(out.bytes)
    expect(Object.keys(back.assets).sort()).toEqual(['ed1', 'ed1.mask', 'img1'])
    expect(back.assets['ed1.mask']).toEqual(stored.mask)
  })

  it('exports only published and selected paintings but keeps drafts in the library', async () => {
    const { lib, p, assets } = sample()
    const draft = createPainting({ title: 'Draft', author: 'Sam' }, now, () => 0.7)
    const out = await writeLibraryPack(upsertPainting(lib, draft), [p.id], assets, now)
    const entries = unzipEntries(out.bytes)
    expect(entries[`textures/${draft.id}.png`]).toBeUndefined()
    const data = unzipEntries(entries['server/ourpaintings-datapack.zip'] ?? new Uint8Array())
    expect(JSON.parse(text(data['data/minecraft/tags/painting_variant/placeable.json']))).toEqual({
      replace: false,
      values: [`ourpaintings:${p.id}`],
    })
    expect(readLibraryPack(out.bytes).library.paintings.map((q) => q.id)).toEqual([p.id, draft.id])
  })

  it('writes the same bytes twice for the same input', async () => {
    const { lib, p, assets } = sample()
    const a = await writeLibraryPack(lib, [p.id], assets, now)
    const b = await writeLibraryPack(lib, [p.id], assets, now)
    expect(Array.from(b.bytes)).toEqual(Array.from(a.bytes))
  })

  it('explains the server steps in English and French', async () => {
    const { lib, p, assets } = sample()
    const out = await writeLibraryPack(lib, [p.id], assets, now)
    const readme = text(unzipEntries(out.bytes)['server/README.txt'])
    expect(readme).toContain('world/datapacks/')
    expect(readme).toContain('ourpaintings-datapack.zip')
    expect(readme).toContain('ourpaintings-resources.zip')
    expect(readme).toContain(serverPropertiesLines(out.sha1))
    expect(readme).toContain(serverPropertiesLines(out.sha1, '<votre lien direct>'))
    expect(readme).toMatch(/\/reload/)
    expect(readme).toMatch(/never delete or rename a published painting/i)
    expect(readme).toMatch(/ne supprimez ni ne renommez jamais un tableau publié/i)
    expect(readme.indexOf('English')).toBeLessThan(readme.indexOf('Français'))
  })

  it('formats the server.properties lines', () => {
    expect(serverPropertiesLines('abc')).toBe(
      'resource-pack=<your direct link>\nresource-pack-sha1=abc\nrequire-resource-pack=true',
    )
  })

  it('puts the given link placeholder in the server.properties lines', () => {
    expect(serverPropertiesLines('abc', '<votre lien direct>')).toBe(
      'resource-pack=<votre lien direct>\nresource-pack-sha1=abc\nrequire-resource-pack=true',
    )
  })

  it('refuses a library file that is not JSON', () => {
    const bad = zipDeterministic({ 'shape-library.json': new TextEncoder().encode('{nope') })
    expect(() => readLibraryPack(bad)).toThrow(/library/i)
  })
})

describe('library pack checks', () => {
  async function packWith(edit: (library: Record<string, unknown>) => void) {
    const { lib, p, assets } = sample()
    const entries = unzipEntries((await writeLibraryPack(lib, [p.id], assets, now)).bytes)
    const library = JSON.parse(text(entries['shape-library.json'])) as Record<string, unknown>
    edit(library)
    entries['shape-library.json'] = new TextEncoder().encode(JSON.stringify(library))
    return zipDeterministic(entries)
  }
  const firstPainting = (library: Record<string, unknown>) =>
    (library.paintings as Record<string, unknown>[])[0] ?? {}
  const failure = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e instanceof ShapeError ? `${e.code}: ${e.message}` : 'other'
    }
    return 'no error'
  }

  it('refuses a painting entry that is not a painting', async () => {
    const partial = await packWith((l) => {
      l.paintings = [{ id: 'x', status: 'published' }]
    })
    expect(failure(() => readLibraryPack(partial))).toMatch(/^not-a-library-pack: .*painting 0/)
    const nulls = await packWith((l) => {
      l.paintings = [null]
    })
    expect(failure(() => readLibraryPack(nulls))).toMatch(/^not-a-library-pack: .*painting 0/)
  })

  it('accepts a pack without exportedAt and refuses a malformed one', async () => {
    const without = await packWith((l) => {
      delete l.exportedAt
    })
    expect(readLibraryPack(without).library.exportedAt).toBeUndefined()
    for (const bad of [42, 'yesterday', '2026-13-45T99:00:00.000Z', '2026-02-30T00:00:00.000Z']) {
      const pack = await packWith((l) => {
        l.exportedAt = bad
      })
      expect(failure(() => readLibraryPack(pack))).toMatch(/^not-a-library-pack: .*exportedAt/)
    }
  })

  it('refuses a bad namespace', async () => {
    const bad = await packWith((l) => {
      l.namespace = '../x'
    })
    expect(failure(() => readLibraryPack(bad))).toMatch(/^not-a-library-pack: .*namespace/)
  })

  it('refuses ids that could escape their folder', async () => {
    const badId = await packWith((l) => {
      firstPainting(l).id = '../evil'
    })
    expect(failure(() => readLibraryPack(badId))).toMatch(/^not-a-library-pack: .*painting 0.*id/)
    const badImage = await packWith((l) => {
      const recipe = firstPainting(l).recipe as Record<string, unknown>
      recipe.source = { imageId: '../img', width: 1, height: 1 }
    })
    expect(failure(() => readLibraryPack(badImage))).toMatch(/^not-a-library-pack: .*source/)
  })

  it('refuses out-of-range fields and repeated ids', async () => {
    const big = await packWith((l) => {
      firstPainting(l).width = 17
    })
    expect(failure(() => readLibraryPack(big))).toMatch(/painting 0 .*width/)
    const twice = await packWith((l) => {
      l.paintings = [firstPainting(l), firstPainting(l)]
    })
    expect(failure(() => readLibraryPack(twice))).toMatch(/painting 1 repeats/)
  })

  it('refuses an image and an edit layer with the same asset name', async () => {
    const { lib, p, assets } = sample()
    const entries = unzipEntries((await writeLibraryPack(lib, [p.id], assets, now)).bytes)
    entries['edits/img1.png'] = entries['images/img1.png'] ?? new Uint8Array()
    expect(failure(() => readLibraryPack(zipDeterministic(entries)))).toMatch(
      /^not-a-library-pack: .*img1/,
    )
  })

  it('names the painting when a stored picture is damaged during export', async () => {
    const { lib, p } = sample()
    const error: unknown = await writeLibraryPack(
      lib,
      [p.id],
      { img1: new Uint8Array([1, 2, 3]) },
      now,
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ShapeError)
    expect(error).toMatchObject({ code: 'export-failed' })
    expect(String((error as Error).message)).toContain('Sunset')
    expect(String((error as Error).message)).toContain(p.id)
  })
})
