import { makeAssetId, makePaintingId } from '../domain/ids.ts'
import { createLibrary, createPainting } from '../domain/library.ts'
import type { Assets, Library, Painting, Random, ShapeId } from '../domain/types.ts'
import { renderScene, type SceneId } from '../imaging/scenes.ts'
import { encodePng } from '../packs/png.ts'
import { useWorkspace, type WorkspaceStore } from './workspace.ts'

const PIXELS_PER_BLOCK = 32

const SAMPLES: Array<{
  title: string
  scene: SceneId
  shape: ShapeId
  width: number
  height: number
}> = [
  { title: 'Sunset Chapel', scene: 'sunset', shape: 'gothic_arch', width: 2, height: 3 },
  { title: 'Night Rose', scene: 'night', shape: 'rose', width: 2, height: 2 },
  { title: 'Spring Window', scene: 'meadow', shape: 'four_panes', width: 2, height: 2 },
  { title: 'Frost Oculus', scene: 'snow', shape: 'oculus', width: 1, height: 1 },
]

/**
 * The sample library: four window paintings drawn from the built-in scenes. They are ready
 * but unpublished, so players can change or delete them freely.
 */
export function buildSampleLibrary(
  name: string,
  random: Random = Math.random,
  now: Date = new Date(),
): { library: Library; assets: Assets } {
  const assets: Assets = {}
  const takenIds = new Set<string>()
  const paintings = SAMPLES.map((s): Painting => {
    const base = createPainting(
      { title: s.title, author: 'Shape', width: s.width, height: s.height },
      now,
      random,
    )
    let id = base.id
    while (takenIds.has(id)) id = makePaintingId(s.title, random)
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

/** Replaces the open library with the sample library; loose paintings stay. */
export function openSampleLibrary(name: string, store: WorkspaceStore = useWorkspace): void {
  const sample = buildSampleLibrary(name)
  store.getState().closeLibrary()
  store.setState((s) => ({ library: sample.library, assets: { ...s.assets, ...sample.assets } }))
}
