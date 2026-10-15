import { useEditor } from '../../state/editor.ts'

/** Pause after the last change before the editor saves it (R19). */
export const AUTOSAVE_MS = 800

export interface Autosave {
  /** Saves pending changes now (leaving, hiding the page, Ctrl+S). */
  flush(): void
  stop(): void
}

/**
 * Calls `save` AUTOSAVE_MS after the last change of the open painting while it has unsaved
 * changes. Never while a pointer is held: a stroke or a drag is saved once released (a save in
 * the middle of one would cut it into two undo steps and make a stroke copy its pixels again).
 */
export function startAutosave(save: () => void): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined
  let held = false

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const schedule = () => {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      // A held pointer schedules again on release.
      if (!held && useEditor.getState().dirty) save()
    }, AUTOSAVE_MS)
  }

  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.painting === prev.painting && state.edits === prev.edits) return
    if (state.dirty) schedule()
    else cancel()
  })
  const onDown = () => {
    held = true
  }
  const onUp = () => {
    if (!held) return
    held = false
    if (useEditor.getState().dirty) schedule()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  // A release outside the window may never arrive.
  window.addEventListener('blur', onUp)

  return {
    flush() {
      cancel()
      if (useEditor.getState().dirty) save()
    },
    stop() {
      cancel()
      unsubscribe()
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('blur', onUp)
    },
  }
}
