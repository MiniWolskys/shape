import { useEffect, useRef, useState, type ComponentType } from 'react'
import { makeAssetId } from '../../domain/ids.ts'
import { retitlePainting, updatePainting } from '../../domain/library.ts'
import type { Assets, Painting } from '../../domain/types.ts'
import { format, useT } from '../../i18n/i18n.ts'
import type { Dictionary } from '../../i18n/en.ts'
import { isEmptyLayer, type EditLayer } from '../../imaging/edits.ts'
import type { Raster } from '../../imaging/raster.ts'
import { decodeEditLayer, decodePng, encodeEditLayer } from '../../packs/png.ts'
import { useEditor, type EditorStep, type Tool } from '../../state/editor.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Button } from '../../ui/Button.tsx'
import { errorMessage } from '../../ui/errors.ts'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import { startAutosave, type Autosave } from './autosave.ts'
import { CanvasStage } from './CanvasStage.tsx'
import styles from './EditorScreen.module.css'
import { StepRail } from './StepRail.tsx'
import { ImageStep } from './steps/ImageStep.tsx'
import { SizeStep } from './steps/SizeStep.tsx'
import { DetailsStep } from './steps/DetailsStep.tsx'
import { PixelsPanel, PixelsStage } from './steps/PixelsStep.tsx'
import { WindowStep } from './steps/WindowStep.tsx'

/**
 * What each step shows: its inspector panel and, optionally, its own stage (a step that paints
 * on the canvas wraps CanvasStage with `onPixel` and `overlay`).
 */
export interface StepView {
  Panel: ComponentType
  Stage?: ComponentType
}

const STEP_VIEWS: Record<EditorStep, StepView> = {
  image: { Panel: ImageStep },
  size: { Panel: SizeStep },
  window: { Panel: WindowStep },
  pixels: { Panel: PixelsPanel, Stage: PixelsStage },
  details: { Panel: DetailsStep },
}

const TOOL_KEYS: Record<string, Tool> = {
  b: 'pencil',
  g: 'fill',
  r: 'replace',
  w: 'wand',
  i: 'eyedropper',
  e: 'eraser',
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Focus is somewhere typing goes: shortcuts must leave the keys alone. */
function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  return target instanceof HTMLElement && target.isContentEditable
}

function decodeSource(p: Painting, assets: Assets, t: Dictionary): Raster | null {
  const id = p.recipe.source?.imageId
  if (id === undefined) return null
  const bytes = assets[id]
  try {
    if (!bytes) throw new Error(`asset ${id} is missing`)
    return decodePng(bytes)
  } catch (error) {
    console.error(`Could not read the picture of ${p.id}`, error)
    toast(t.editor.sourceUnreadable, 'error')
    return null
  }
}

/**
 * Edit assets of the open painting that could not be read. A save without new edits keeps
 * them as they are (they may be readable by a later version) instead of dropping them.
 */
let unreadableEditsId: string | null = null
/** Paintings already warned about, so the warning shows once (not on every reopen). */
const warnedUnreadable = new Set<string>()

function decodeEdits(p: Painting, assets: Assets, t: Dictionary): EditLayer | null {
  const id = p.recipe.editsId
  if (id === null) return null
  const values = assets[id]
  const mask = assets[`${id}.mask`]
  try {
    if (!values || !mask) throw new Error(`edit assets of ${id} are missing`)
    return decodeEditLayer(values, mask)
  } catch (error) {
    console.error(`Could not read the edits of ${p.id}`, error)
    unreadableEditsId = id
    const key = `${p.id}:${id}`
    if (!warnedUnreadable.has(key)) {
      warnedUnreadable.add(key)
      toast(t.editor.editsUnreadable, 'error')
    }
    return null
  }
}

/**
 * Gives the painting the id its title asks for (R17), changing the workspace: a stored painting
 * is retitled there; a new one gets an id made from its title. Called last in a save, once
 * nothing else can fail, so a failed save never leaves the editor on an id the workspace dropped.
 */
function renameForTitle(p: Painting): string {
  const workspace = useWorkspace.getState()
  const stored = workspace.findPainting(p.id)
  if (stored) return stored.title === p.title ? p.id : workspace.retitlePainting(p.id, p.title)
  // A new painting's id was made for an empty title.
  if (p.title === '') return p.id
  const { library, loose } = workspace
  const taken = new Set([...(library?.paintings ?? []), ...loose].map((q) => q.id))
  return retitlePainting(p, p.title, taken, new Date(), Math.random).id
}

/**
 * Writes the editor's painting and edit layer to the workspace (adding a new painting on its
 * first save, R18); returns the saved painting. The route follows a new id.
 */
function savePaintingNow(): Painting | null {
  const { painting, edits } = useEditor.getState()
  if (!painting) return null
  const workspace = useWorkspace.getState()
  // No edits (none made, or all undone) means no edit assets: the old ones get pruned below,
  // unless they could not be read, in which case they stay untouched.
  const hasEdits = edits !== null && !isEmptyLayer(edits)
  let editsId = hasEdits ? (painting.recipe.editsId ?? unreadableEditsId) : unreadableEditsId
  if (hasEdits) {
    if (editsId === null) {
      const { assets } = workspace
      do editsId = makeAssetId(Math.random)
      while (editsId in assets || `${editsId}.mask` in assets)
    }
    const encoded = encodeEditLayer(edits)
    workspace.setAsset(editsId, encoded.values)
    workspace.setAsset(`${editsId}.mask`, encoded.mask)
    // New edits replaced the unreadable ones.
    unreadableEditsId = null
  }
  const updated = updatePainting(painting, { recipe: { ...painting.recipe, editsId } }, new Date())
  const id = renameForTitle(updated)
  const saved = id === updated.id ? updated : { ...updated, id }
  workspace.savePainting(saved)
  useEditor.getState().markSaved(saved)
  workspace.pruneUnreferencedAssets(historyPictureIds())
  const navigation = useNavigation.getState()
  const { screen } = navigation
  if (
    screen.name === 'editor' &&
    screen.paintingId !== id &&
    (screen.paintingId === null || screen.paintingId === painting.id)
  ) {
    navigation.go({ name: 'editor', paintingId: id })
  }
  return saved
}

/** Pictures Undo or Redo can still bring back, which must outlive a save. */
function historyPictureIds(): string[] {
  const { painting, past, future } = useEditor.getState()
  const paintings = [...past, ...future].map((s) => s.painting)
  if (painting) paintings.push(painting)
  return paintings.flatMap((p) => (p.recipe.source ? [p.recipe.source.imageId] : []))
}

type SaveStatus = 'saving' | 'saved' | 'notSaved' | 'failed'

export function EditorScreen({ paintingId }: { paintingId: string | null }) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const painting = useEditor((s) => s.painting)
  const step = useEditor((s) => s.step)
  const dirty = useEditor((s) => s.dirty)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const openId = painting?.id
  const stored = useWorkspace(
    (s) =>
      openId !== undefined &&
      (s.loose.some((p) => p.id === openId) ||
        (s.library?.paintings.some((p) => p.id === openId) ?? false)),
  )
  const session = useEditor((s) => s.session)
  // The editing session whose last save failed: opening another painting forgets it.
  const [failedIn, setFailedIn] = useState<number | null>(null)
  const autosave = useRef<Autosave | null>(null)

  // The dictionary is read when opening, but a language change must not reopen the painting.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  /** Saves now; a failure is shown, and the next change tries again. */
  const save = useRef<() => boolean>(() => true)
  useEffect(() => {
    save.current = () => {
      try {
        savePaintingNow()
        setFailedIn(null)
        return true
      } catch (error) {
        setFailedIn(useEditor.getState().session)
        toast(errorMessage(error, tRef.current), 'error')
        return false
      }
    }
  })

  // Opens the painting the route names, unless it is the open one under a new id (R17).
  useEffect(() => {
    const t = tRef.current
    const editor = useEditor.getState()
    if (paintingId !== null && editor.painting?.id === paintingId) return
    // Another painting takes the open one's place: that one is saved first.
    autosave.current?.flush()
    const workspace = useWorkspace.getState()
    unreadableEditsId = null
    if (paintingId === null) {
      editor.open(workspace.draftPainting(), null, null)
      return
    }
    const p = workspace.findPainting(paintingId)
    if (!p) {
      toast(t.editor.notFound, 'error')
      go({ name: 'library' })
      return
    }
    editor.open(p, decodeSource(p, workspace.assets, t), decodeEdits(p, workspace.assets, t))
  }, [paintingId, go])

  // Autosave (R19) while the editor is shown; leaving saves what is pending.
  useEffect(() => {
    const running = startAutosave(() => save.current())
    autosave.current = running
    return () => {
      const saved = running.flush()
      running.stop()
      autosave.current = null
      unreadableEditsId = null
      useEditor.getState().close()
      // Pictures chosen but never saved are not needed once the editor is gone; after a failed
      // save they may be all that is left of the work, so they stay.
      if (saved) useWorkspace.getState().pruneUnreferencedAssets()
    }
  }, [])

  // Hiding or closing the page saves at once and writes the workspace to storage.
  useEffect(() => {
    function flushToStorage() {
      autosave.current?.flush()
      void useWorkspace.getState().persistNow()
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushToStorage()
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const pending = useEditor.getState().dirty
      flushToStorage()
      if (!pending) return
      // The browser asks before leaving, which gives the storage time to finish.
      event.preventDefault()
      // Older browsers need returnValue set to show their prompt.
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushToStorage)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushToStorage)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && key === 's') {
        // Never let the browser's own Save dialog open: Ctrl+S saves at once.
        event.preventDefault()
        autosave.current?.flush()
        void useWorkspace.getState().persistNow()
        return
      }
      if (document.querySelector('dialog[open]') !== null) return
      const editor = useEditor.getState()
      if (isTextEntry(event.target)) return
      if (mod && !event.altKey) {
        if (key === 'z' && !event.shiftKey) editor.undo()
        else if (key === 'y' || (key === 'z' && event.shiftKey)) editor.redo()
        else return
        event.preventDefault()
        return
      }
      if (key === 'escape' && editor.selection) {
        editor.setSelection(null)
        event.preventDefault()
        return
      }
      if (event.altKey || event.shiftKey) return
      const tool = TOOL_KEYS[key]
      if (!tool) return
      // The tools live on Colors & pixels: their keys go there (M3).
      editor.setTool(tool)
      if (editor.step !== 'pixels') editor.setStep('pixels')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!painting) return null

  /** Back and the logo save what is pending, then leave (M14); a failed save stays here. */
  function leave(to: 'library' | 'home') {
    if (autosave.current?.flush() === false) return
    go({ name: to })
  }

  let status: SaveStatus = 'saved'
  if (failedIn === session) status = 'failed'
  else if (dirty) status = 'saving'
  else if (!stored) status = 'notSaved'

  const { Panel, Stage = DefaultStage } = STEP_VIEWS[step]
  const title = painting.title || t.library.untitled

  return (
    <div className={styles.page}>
      <TopBar
        onHome={() => leave('home')}
        left={
          <div className={styles.heading}>
            <Button variant="ghost" icon="arrow-left" onClick={() => leave('library')}>
              {t.editor.backToLibrary}
            </Button>
            <h1 className={styles.title}>{title}</h1>
            <span className={styles.chip}>
              {format(t.editor.sizeChip, {
                width: painting.width,
                height: painting.height,
                ppb: painting.pixelsPerBlock,
              })}
            </span>
            <span className={styles.status} data-status={status} role="status">
              {t.editor.saveStatus[status]}
            </span>
          </div>
        }
        right={
          <div className={styles.actions}>
            <Button
              variant="ghost"
              icon="undo"
              disabled={!canUndo}
              onClick={() => useEditor.getState().undo()}
            >
              <span className={styles.narrowHidden}>{t.editor.undo}</span>
            </Button>
            <Button
              variant="ghost"
              icon="redo"
              disabled={!canRedo}
              onClick={() => useEditor.getState().redo()}
            >
              <span className={styles.narrowHidden}>{t.editor.redo}</span>
            </Button>
          </div>
        }
      />
      <div className={styles.editor}>
        <StepRail />
        <Stage />
        <aside className={styles.inspector} aria-label={t.editor.steps[step]}>
          <Panel />
        </aside>
      </div>
    </div>
  )
}

function DefaultStage() {
  return <CanvasStage />
}
