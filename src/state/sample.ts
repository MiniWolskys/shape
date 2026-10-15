import { makeAssetId, makePaintingId } from '../domain/ids.ts'
import { createLibrary, createPainting } from '../domain/library.ts'
import type { Assets, Library, Painting, Random, ShapeId } from '../domain/types.ts'
import { renderScene, type SceneId } from '../imaging/scenes.ts'
import { encodePng } from '../packs/png.ts'
import { useWorkspace, type WorkspaceStore } from './workspace.ts'

const PIXELS_PER_BLOCK = 32

/** The sample paintings' title keys; the caller gives each title in the current language. */
export type SampleTitles = Record<
  'sunsetChapel' | 'nightRose' | 'springWindow' | 'frostOculus',
  string
>

const SAMPLES: Array<{
  title: keyof SampleTitles
  scene: SceneId
  shape: ShapeId
  width: number
  height: number
}> = [
  { title: 'sunsetChapel', scene: 'sunset', shape: 'gothic_arch', width: 2, height: 3 },
  { title: 'nightRose', scene: 'night', shape: 'rose', width: 2, height: 2 },
  { title: 'springWindow', scene: 'meadow', shape: 'four_panes', width: 2, height: 2 },
  { title: 'frostOculus', scene: 'snow', shape: 'oculus', width: 1, height: 1 },
]

/**
 * The sample library: four window paintings drawn from the built-in scenes. They are ready
 * but unpublished, so players can change or delete them freely.
 */
export function buildSampleLibrary(
  name: string,
  titles: SampleTitles,
  random: Random = Math.random,
  now: Date = new Date(),
): { library: Library; assets: Assets } {
  const assets: Assets = {}
  const takenIds = new Set<string>()
  const paintings = SAMPLES.map((s): Painting => {
    const title = titles[s.title]
    const base = createPainting(
      { title, author: 'Shape', width: s.width, height: s.height },
      now,
      random,
    )
    let id = base.id
    while (takenIds.has(id)) id = makePaintingId(title, random)
    takenIds.add(id)
    let imageId = makeAssetId(random)
    while (imageId in assets) imageId = makeAssetId(random)
    const width = s.width * PIXELS_PER_BLOCK
    const height = s.height * PIXELS_PER_BLOCK
    assets[imageId] = encodePng(renderScene(s.scene, width, height))
    return {
      ...base,
      id,
      pixelsPerBlock: PIXELS_PER_BLOCK,
      status: 'ready',
      recipe: {
        ...base.recipe,
        source: { imageId, width, height },
        window: { shape: s.shape, glassOpacity: 1 },
      },
    }
  })
  return { library: { ...createLibrary(name, 'sample'), paintings }, assets }
}

/**
 * Replaces the open library with the sample library, marked as the demo (R23); loose paintings
 * stay. Closing deletes the open library's paintings: ask first (see `unexportedCount`).
 */
export function openSampleLibrary(
  name: string,
  titles: SampleTitles,
  store: WorkspaceStore = useWorkspace,
): void {
  const sample = buildSampleLibrary(name, titles)
  store.getState().closeLibrary()
  store.setState((s) => ({
    library: sample.library,
    assets: { ...s.assets, ...sample.assets },
    demo: true,
    demoIds: sample.library.paintings.map((p) => p.id),
  }))
}
