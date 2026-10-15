import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPainting } from '../../domain/library.ts'
import type { Painting } from '../../domain/types.ts'
import { useEditor } from '../../state/editor.ts'
import { AUTOSAVE_MS, startAutosave, type Autosave } from './autosave.ts'

const painting = createPainting({ title: 'Test' }, new Date('2026-10-15T12:00:00Z'), () => 0.5)
const retitle = (title: string) => useEditor.getState().change((p) => ({ ...p, title }))

describe('autosave', () => {
  let save: ReturnType<typeof vi.fn<() => void>>
  let autosave: Autosave

  beforeEach(() => {
    vi.useFakeTimers()
    useEditor.getState().open(painting, null, null)
    // A save makes the current state the clean one, as the editor's real save does.
    save = vi.fn(() => {
      const current = useEditor.getState().painting as Painting
      useEditor.getState().markSaved({ ...current })
    })
    autosave = startAutosave(save)
  })
  afterEach(() => {
    autosave.stop()
    vi.useRealTimers()
  })

  it('saves once, AUTOSAVE_MS after the last change', () => {
    retitle('A')
    vi.advanceTimersByTime(AUTOSAVE_MS - 100)
    retitle('AB')
    vi.advanceTimersByTime(AUTOSAVE_MS - 1)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(AUTOSAVE_MS * 3)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('never saves while a pointer is held (a stroke or a drag), then saves after release', () => {
    window.dispatchEvent(new Event('pointerdown'))
    retitle('A')
    vi.advanceTimersByTime(AUTOSAVE_MS * 4)
    expect(save).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pointerup'))
    vi.advanceTimersByTime(AUTOSAVE_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not save a change that was undone before the delay', () => {
    retitle('A')
    useEditor.getState().undo()
    vi.advanceTimersByTime(AUTOSAVE_MS)
    expect(save).not.toHaveBeenCalled()
  })

  it('flush saves pending changes at once, and nothing when everything is saved', () => {
    autosave.flush()
    expect(save).not.toHaveBeenCalled()
    retitle('A')
    autosave.flush()
    expect(save).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(AUTOSAVE_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('stops listening once stopped', () => {
    autosave.stop()
    retitle('A')
    vi.advanceTimersByTime(AUTOSAVE_MS)
    expect(save).not.toHaveBeenCalled()
  })
})
