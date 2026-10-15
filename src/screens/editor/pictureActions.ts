import type { Painting } from '../../domain/types.ts'
import { currentDictionary, format } from '../../i18n/i18n.ts'
import { fileToRaster } from '../../imaging/decode.ts'
import { encodePng } from '../../packs/png.ts'
import { isCustomCrop, useEditor } from '../../state/editor.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { errorMessage } from '../../ui/errors.ts'
import { toast } from '../../ui/toastStore.ts'

/** The picture types the editor takes, as for <input accept>. */
export const IMAGE_TYPES = 'image/*'

/**
 * What `loadPicture` did: `loaded` the picture, `sized` it as a first picture (the toast saying
 * so is shown), `failed` (an error toast is shown) or nothing, the editor having moved on.
 */
export type PictureResult = 'loaded' | 'sized' | 'failed' | 'stale'

/**
 * Uses a file as the open painting's picture. A first picture sizes the painting to fit (R20),
 * which a toast says, with a way to Size & crop.
 */
export async function loadPicture(file: File): Promise<PictureResult> {
  // Decoding takes a while: the result only belongs to the session that asked for it.
  const session = useEditor.getState().session
  try {
    const raster = await fileToRaster(file)
    if (useEditor.getState().session !== session) return 'stale'
    const imageId = useWorkspace.getState().putAsset(encodePng(raster))
    const { autoSized } = useEditor.getState().setSource(raster, imageId)
    if (!autoSized) return 'loaded'
    const t = currentDictionary()
    toast(format(t.editor.image.autoSized, autoSized), 'info', {
      label: t.editor.image.change,
      run() {
        if (useEditor.getState().session === session) useEditor.getState().setStep('size')
      },
    })
    return 'sized'
  } catch (error) {
    toast(errorMessage(error, currentDictionary()), 'error')
    return 'failed'
  }
}

/**
 * Runs a change that may put the crop back in the centre (turning, flipping, resizing). When it
 * did so to a crop the player had set, a toast says so and offers Undo (M13).
 */
export function noticeCropReset(run: () => void): void {
  const before = useEditor.getState().painting
  run()
  const after = useEditor.getState().painting
  if (!before || !after || after === before || !isCustomCrop(before)) return
  if (sameCrop(before, after)) return
  // Saves don't count as changes, so Undo still works after an autosave renamed the history.
  const { revision, session } = useEditor.getState()
  const t = currentDictionary()
  toast(t.editor.cropRecentred, 'info', {
    label: t.editor.undo,
    run() {
      // Only while nothing else was done since: Undo must take back this change.
      const now = useEditor.getState()
      if (now.session === session && now.revision === revision) now.undo()
    },
  })
}

function sameCrop(a: Painting, b: Painting): boolean {
  const x = a.recipe.crop
  const y = b.recipe.crop
  return x.x === y.x && x.y === y.y && x.width === y.width && x.height === y.height
}
