import type { Dictionary } from '../i18n/en.ts'
import { currentDictionary, format } from '../i18n/i18n.ts'
import { useEditor } from '../state/editor.ts'
import { useNavigation, type Screen } from '../state/navigation.ts'
import { toast } from '../ui/toastStore.ts'
import { loadPicture } from './editor/pictureActions.ts'
import { importPackFile } from './packImport.ts'

export type FileKind = 'image' | 'zip' | 'other'

const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip'])
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|avif)$/i

/** What a file looks like, from its type or, when the system gives none, its name. */
export function fileKind(file: { name: string; type: string }): FileKind {
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (ZIP_TYPES.has(type) || file.name.toLowerCase().endsWith('.zip')) return 'zip'
  if (type === '' && IMAGE_NAME.test(file.name)) return 'image'
  return 'other'
}

/**
 * What a file dropped (or pasted) anywhere in the app does (C4): a picture in the editor
 * becomes the painting's picture, a pack on Home or in the Library is imported; anything else
 * gets an explanation.
 */
export type DropRoute = 'picture' | 'pack' | 'needsLibrary' | 'needsPainting' | 'unsupported'

export function routeDrop(screen: Screen, kind: FileKind): DropRoute {
  if (kind === 'other') return 'unsupported'
  if (screen.name === 'editor') return kind === 'image' ? 'picture' : 'needsLibrary'
  if (kind === 'image') return 'needsPainting'
  return screen.name === 'export' ? 'needsLibrary' : 'pack'
}

/**
 * The route of a drag still in the air, when only the MIME types are known (often empty for
 * zips): an unknown type is taken to be what the screen expects.
 */
export function predictRoute(screen: Screen, types: readonly string[]): DropRoute {
  const known = types.find((type) => type !== '')
  if (known !== undefined) return routeDrop(screen, fileKind({ name: '', type: known }))
  return routeDrop(screen, screen.name === 'editor' ? 'image' : 'zip')
}

/** The overlay's words for a drag on its way to `route`. */
export function routeLabel(route: DropRoute, t: Dictionary): string {
  switch (route) {
    case 'picture':
      return t.drop.picture
    case 'pack':
      return t.drop.pack
    default:
      return t.drop[route]
  }
}

/** Does what a drop or paste of `files` on the current screen calls for (the first file counts). */
export async function receiveFiles(files: readonly File[]): Promise<void> {
  const [file] = files
  if (!file) return
  const { screen, go } = useNavigation.getState()
  const route = routeDrop(screen, fileKind(file))
  const t = currentDictionary()
  switch (route) {
    case 'picture': {
      const editor = useEditor.getState()
      if (!editor.painting) return
      // The picture's own settings are where its result shows.
      editor.setStep('image')
      if ((await loadPicture(file)) === 'loaded') {
        toast(format(t.drop.pictureSet, { file: file.name }))
      }
      return
    }
    case 'pack':
      if ((await importPackFile(file)) && screen.name === 'home') go({ name: 'library' })
      return
    default:
      toast(t.drop[route])
  }
}
