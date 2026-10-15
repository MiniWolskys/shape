import { describe, expect, it } from 'vitest'
import { decodePng } from '../packs/png.ts'
import { memoryStorage } from '../storage/persistence.ts'
import { buildSampleLibrary, openSampleLibrary, type SampleTitles } from './sample.ts'
import { createWorkspaceStore } from './workspace.ts'

const titles: SampleTitles = {
  sunsetChapel: 'Chapelle au couchant',
  nightRose: 'Rose de nuit',
  springWindow: 'Fenêtre de printemps',
  frostOculus: 'Oculus de givre',
}

describe('buildSampleLibrary', () => {
  it('builds the "sample" library with four ready window paintings', () => {
    const { library, assets } = buildSampleLibrary('Sample paintings', titles)
    expect(library.name).toBe('Sample paintings')
    expect(library.namespace).toBe('sample')
    expect(library.paintings.map((p) => p.recipe.window.shape)).toEqual([
      'gothic_arch',
      'rose',
      'four_panes',
      'oculus',
    ])
    for (const p of library.paintings) {
      expect(p.status).toBe('ready')
      expect(p.id).toMatch(/^[a-z0-9_]+$/)
      const source = p.recipe.source
      expect(source).not.toBeNull()
      if (!source) continue
      expect(source.imageId).toMatch(/^[A-Za-z0-9_-]+$/)
      const bytes = assets[source.imageId]
      expect(bytes).toBeDefined()
      if (!bytes) continue
      const image = decodePng(bytes)
      expect([image.width, image.height]).toEqual([source.width, source.height])
      expect(source.width).toBe(p.width * p.pixelsPerBlock)
      expect(source.height).toBe(p.height * p.pixelsPerBlock)
    }
    expect(new Set(library.paintings.map((p) => p.id)).size).toBe(4)
  })

  it('titles the paintings in the given language, with ids from those titles', () => {
    const { library } = buildSampleLibrary('Tableaux', titles)
    expect(library.paintings.map((p) => p.title)).toEqual(Object.values(titles))
    expect(library.paintings[0]?.id).toMatch(/^chapelle_au_couchant_[a-z0-9]{3}$/)
  })

  it('never reuses a painting or asset id the workspace already has', () => {
    // The same random sequence twice: the second build first draws the very ids of the first.
    const seeded = () => {
      let n = 0
      return () => (n++ * 0.6180339) % 1
    }
    const first = buildSampleLibrary('Sample', titles, seeded())
    const takenIds = first.library.paintings.map((p) => p.id)
    const takenAssetIds = Object.keys(first.assets)
    const { library, assets } = buildSampleLibrary('Sample', titles, seeded(), new Date(), {
      takenIds,
      takenAssetIds,
    })
    for (const p of library.paintings) expect(takenIds).not.toContain(p.id)
    for (const id of Object.keys(assets)) expect(takenAssetIds).not.toContain(id)
  })
})

describe('openSampleLibrary', () => {
  it('opens the sample library and keeps loose paintings', async () => {
    const store = createWorkspaceStore(memoryStorage())
    await store.getState().init()
    const loose = store.getState().createPainting()
    openSampleLibrary('Sample paintings', titles, store)
    const { library, loose: after, assets } = store.getState()
    expect(library?.namespace).toBe('sample')
    expect(after.map((p) => p.id)).toEqual([loose])
    expect(store.getState().demo).toBe(true)
    expect(store.getState().demoIds).toEqual(library?.paintings.map((p) => p.id))
    expect(store.getState().unexportedCount()).toBe(0)
    for (const p of library?.paintings ?? []) {
      expect(assets[p.recipe.source?.imageId ?? '']).toBeDefined()
    }
  })
})
