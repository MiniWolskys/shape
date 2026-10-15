import { useEffect, useRef, useState, type ComponentType } from 'react'
import { makeAssetId } from '../../domain/ids.ts'
import { updatePainting } from '../../domain/library.ts'
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
import { Dialog } from '../../ui/Dialog.tsx'
import { errorMessage } from '../../ui/errors.ts'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
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

/** Writes the editor's painting and edit layer to the workspace; returns the saved painting. */
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
  const saved = updatePainting(painting, { recipe: { ...painting.recipe, editsId } }, new Date())
  workspace.savePainting(saved)
  useEditor.getState().markSaved(saved)
  workspace.pruneUnreferencedAssets(historyPictureIds())
  return saved
}

/** Pictures Undo or Redo can still bring back, which must outlive a save. */
function historyPictureIds(): string[] {
  const { painting, past, future } = useEditor.getState()
  const paintings = [...past, ...future].map((s) => s.painting)
  if (painting) paintings.push(painting)
  return paintings.flatMap((p) => (p.recipe.source ? [p.recipe.source.imageId] : []))
}

export function EditorScreen({ paintingId }: { paintingId: string }) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const painting = useEditor((s) => s.painting)
  const step = useEditor((s) => s.step)
  const dirty = useEditor((s) => s.dirty)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const [leaving, setLeaving] = useState(false)

  // The dictionary is read when opening, but a language change must not reopen the painting.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  useEffect(() => {
    const t = tRef.current
    const workspace = useWorkspace.getState()
    const p = workspace.findPainting(paintingId)
    unreadableEditsId = null
    if (!p) {
      toast(t.editor.notFound, 'error')
      go({ name: 'library' })
      return
    }
    useEditor
      .getState()
      .open(p, decodeSource(p, workspace.assets, t), decodeEdits(p, workspace.assets, t))
    return () => {
      unreadableEditsId = null
      useEditor.getState().close()
      // Pictures chosen but never saved are not needed once the editor is gone.
      useWorkspace.getState().pruneUnreferencedAssets()
    }
  }, [paintingId, go])

  function save(): boolean {
    try {
      savePaintingNow()
      toast(t.common.saved)
      return true
    } catch (error) {
      toast(errorMessage(error, t), 'error')
      return false
    }
  }

  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      const dialogOpen = document.querySelector('dialog[open]') !== null
      if (mod && !event.altKey && key === 's') {
        // Never let the browser's own Save dialog open, even while ours is showing.
        event.preventDefault()
        if (!dialogOpen) saveRef.current()
        return
      }
      if (dialogOpen) return
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
      if (tool) editor.setTool(tool)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveRef])

  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Older browsers need returnValue set to show their prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (!painting || painting.id !== paintingId) return null

  function back() {
    if (useEditor.getState().dirty) setLeaving(true)
    else go({ name: 'library' })
  }

  function saveAndLeave() {
    if (save()) {
      setLeaving(false)
      go({ name: 'library' })
    }
  }

  const { Panel, Stage = DefaultStage } = STEP_VIEWS[step]
  const title = painting.title || t.library.untitled

  return (
    <div className={styles.page}>
      <TopBar
        left={
          <div className={styles.heading}>
            <Button variant="ghost" icon="arrow-left" onClick={back}>
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
            <Button variant="primary" onClick={() => save()}>
              {t.editor.savePainting}
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

      <Dialog
        open={leaving}
        title={t.editor.unsavedTitle}
        onClose={() => setLeaving(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                setLeaving(false)
                go({ name: 'library' })
              }}
            >
              {t.editor.discard}
            </Button>
            <Button variant="primary" onClick={saveAndLeave}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <p className={styles.warning}>{t.editor.unsavedBody}</p>
      </Dialog>
    </div>
  )
}

function DefaultStage() {
  return <CanvasStage />
}
