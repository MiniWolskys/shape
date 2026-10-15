import { describe, expect, it } from 'vitest'
import { decodePng } from '../packs/png.ts'
import { memoryStorage } from '../storage/persistence.ts'
import { buildSampleLibrary, openSampleLibrary } from './sample.ts'
import { createWorkspaceStore } from './workspace.ts'

describe('buildSampleLibrary', () => {
  it('builds the "sample" library with four ready window paintings', () => {
    const { library, assets } = buildSampleLibrary('Sample paintings')
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
})

describe('openSampleLibrary', () => {
  it('opens the sample library and keeps loose paintings', async () => {
    const store = createWorkspaceStore(memoryStorage())
    await store.getState().init()
    const loose = store.getState().createPainting()
    openSampleLibrary('Sample paintings', store)
    const { library, loose: after, assets } = store.getState()
    expect(library?.namespace).toBe('sample')
    expect(after.map((p) => p.id)).toEqual([loose])
    for (const p of library?.paintings ?? []) {
      expect(assets[p.recipe.source?.imageId ?? '']).toBeDefined()
    }
  })
})
