import type { Dictionary } from '../i18n/en.ts'
import type { Screen } from '../state/navigation.ts'

/**
 * The browser tab's title for a screen (M6): "Library · Shape", or in the editor the painting's
 * title first ("Rosace du soir · Éditeur · Shape"). `paintingTitle` is null while none is open.
 */
export function documentTitle(screen: Screen, t: Dictionary, paintingTitle: string | null): string {
  const app = t.app.name
  switch (screen.name) {
    case 'home':
      return `${app} · ${t.app.tagline}`
    case 'library':
      return `${t.library.title} · ${app}`
    case 'export':
      return `${t.export.title} · ${app}`
    case 'editor':
      if (paintingTitle === null) return `${t.editor.title} · ${app}`
      return `${paintingTitle || t.library.untitled} · ${t.editor.title} · ${app}`
  }
}
