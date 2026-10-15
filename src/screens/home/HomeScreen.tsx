import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { format, plural, useT } from '../../i18n/i18n.ts'
import { renderScene } from '../../imaging/scenes.ts'
import { hashString } from '../../imaging/shapes.ts'
import { renderWallPreview } from '../../imaging/wall.ts'
import { applyWindow } from '../../imaging/window.ts'
import { useNavigation } from '../../state/navigation.ts'
import { openSampleLibrary } from '../../state/sample.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { errorMessage } from '../../ui/errors.ts'
import { FileDrop } from '../../ui/FileDrop.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import styles from './HomeScreen.module.css'
import { NewLibraryDialog } from './NewLibraryDialog.tsx'

const SHOWCASE = { width: 3, height: 4, ppb: 32 }
const SHOWCASE_FALLBACK_BOX = { width: 480, height: 576 }
const SAMPLE_NAMESPACE = 'sample'

/** A gothic-arch sunset window, three by four blocks, on a stone wall. */
function renderShowcase() {
  const { width, height, ppb } = SHOWCASE
  const painting = applyWindow(renderScene('sunset', width * ppb, height * ppb), {
    shape: 'gothic_arch',
    glassOpacity: 1,
    material: 'dark_oak',
    thickness: 2,
    pixelsPerBlock: ppb,
    seed: hashString('shape-home'),
  })
  return renderWallPreview(painting, width, height, ppb, { reference: false })
}

function renderResumeThumb() {
  return applyWindow(renderScene('night', 16, 16), {
    shape: 'rose',
    glassOpacity: 1,
    material: 'dark_oak',
    thickness: 1,
    pixelsPerBlock: 16,
    seed: hashString('shape-resume'),
  })
}

/** The content box of an element, tracked while it resizes. */
function useContentBox(fallback: { width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setBox({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, box] as const
}

export function HomeScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const loose = useWorkspace((s) => s.loose)
  // The workspace autosaves, so whatever it holds now is the saved work to resume.
  const hasSavedWork = library !== null || loose.length > 0
  const [libraryDialog, setLibraryDialog] = useState<{ open: boolean; key: number }>({
    open: false,
    key: 0,
  })
  const [confirmSample, setConfirmSample] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const ids = { create: useId(), createHint: useId(), resume: useId(), resumeDetail: useId() }

  const showcase = useMemo(() => renderShowcase(), [])
  const resumeThumb = useMemo(() => renderResumeThumb(), [])
  const [showcaseRef, showcaseBox] = useContentBox(SHOWCASE_FALLBACK_BOX)

  function createPainting() {
    const paintingId = useWorkspace.getState().createPainting()
    go({ name: 'editor', paintingId })
  }

  async function openPack(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { added } = useWorkspace.getState().importPack(bytes)
      toast(plural(t, t.home.packAdded, added))
      go({ name: 'library' })
    } catch (error) {
      const namespace = useWorkspace.getState().library?.namespace ?? ''
      toast(errorMessage(error, t, { namespace }), 'error')
    }
  }

  function onFiles(files: File[]) {
    const [file] = files
    if (file) void openPack(file)
  }

  function resume() {
    const [only] = loose
    if (!library && loose.length === 1 && only) go({ name: 'editor', paintingId: only.id })
    else go({ name: 'library' })
  }

  function createLibrary(name: string, namespace: string) {
    useWorkspace.getState().createLibrary(name, namespace)
    setLibraryDialog((d) => ({ ...d, open: false }))
    go({ name: 'library' })
  }

  function openSample() {
    setConfirmSample(false)
    if (useWorkspace.getState().library?.namespace !== SAMPLE_NAMESPACE) {
      openSampleLibrary(t.home.sampleName, t.home.sampleTitles)
    }
    go({ name: 'library' })
  }

  function trySample() {
    if (library && library.namespace !== SAMPLE_NAMESPACE) setConfirmSample(true)
    else openSample()
  }

  const inProgress =
    (library?.paintings.filter((p) => p.status !== 'published').length ?? 0) + loose.length
  const resumeDetail = [
    library && format(t.home.resumeLibrary, { name: library.name, version: library.version }),
    inProgress > 0 && plural(t, t.home.inProgress, inProgress),
  ]
    .filter(Boolean)
    .join(' · ')

  const caption = format(t.home.showcaseCaption, {
    shape: t.shapes.gothic_arch,
    width: SHOWCASE.width,
    height: SHOWCASE.height,
  })
  const [hintBefore = '', hintAfter = ''] = t.home.openPackHint.split('{file}')
  const packFile = library ? `${library.namespace}-v${library.version}.zip` : t.home.anyPackFile

  return (
    <FileDrop accept="" onFiles={onFiles} fullWindow>
      <div className={styles.page}>
        <TopBar />
        <main className={styles.home}>
          <section className={styles.intro}>
            <p className={styles.eyebrow}>{t.home.eyebrow}</p>
            <h1 className={styles.headline}>
              {t.home.headlineBefore}
              <em>{t.home.headlineEmphasis}</em>
              {t.home.headlineAfter}
            </h1>
            <p className={styles.lede}>
              {t.home.lede} {t.home.privacy}
            </p>

            <div className={styles.actions}>
              <div className={styles.cards}>
                <button
                  type="button"
                  className={`${styles.card} ${styles.createCard}`}
                  aria-labelledby={ids.create}
                  aria-describedby={ids.createHint}
                  onClick={createPainting}
                >
                  <Icon name="image" size={30} className={styles.cardIcon} />
                  <span id={ids.create} className={styles.cardTitle}>
                    {t.home.createPainting}
                  </span>
                  <span id={ids.createHint} className={styles.cardHint}>
                    {t.home.createPaintingHint}
                  </span>
                  <span className={styles.fauxPrimary} aria-hidden="true">
                    <Icon name="plus" />
                    {t.home.startPainting}
                  </span>
                </button>

                <div className={`${styles.card} ${styles.dropCard}`}>
                  <Icon name="folder" size={30} className={styles.cardIcon} />
                  <h2 className={styles.cardTitle}>{t.home.openPack}</h2>
                  <p className={styles.cardHint}>
                    {hintBefore}
                    <b className={styles.fileName}>{packFile}</b>
                    {hintAfter}
                  </p>
                  <Button className={styles.cardButton} onClick={() => fileInput.current?.click()}>
                    {t.home.browse}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".zip,application/zip"
                    hidden
                    onChange={(event) => {
                      onFiles(Array.from(event.target.files ?? []))
                      event.target.value = ''
                    }}
                  />
                </div>
              </div>

              {hasSavedWork && (
                <button
                  type="button"
                  className={styles.resume}
                  aria-labelledby={ids.resume}
                  aria-describedby={ids.resumeDetail}
                  onClick={resume}
                >
                  <span className={styles.resumeThumb} aria-hidden="true">
                    <PaintingCanvas raster={resumeThumb} scale={2.75} label="" backdrop="mid" />
                  </span>
                  <span className={styles.resumeText}>
                    <span id={ids.resume} className={styles.resumeTitle}>
                      {t.home.resume}
                    </span>
                    {resumeDetail && (
                      <span id={ids.resumeDetail} className={styles.resumeDetail}>
                        {resumeDetail}
                      </span>
                    )}
                  </span>
                  <span className={styles.fauxButton} aria-hidden="true">
                    {t.home.resumeButton}
                  </span>
                </button>
              )}

              <div className={styles.secondary}>
                <Button
                  icon="plus"
                  onClick={() => setLibraryDialog((d) => ({ open: true, key: d.key + 1 }))}
                >
                  {t.home.newLibrary}
                </Button>
                <Button variant="ghost" onClick={trySample}>
                  {t.home.trySample}
                </Button>
              </div>
            </div>
          </section>

          <figure className={styles.showcase}>
            <div className={styles.stage} ref={showcaseRef}>
              <PaintingCanvas raster={showcase} fit={showcaseBox} label={caption} />
            </div>
            <figcaption className={styles.caption} aria-hidden="true">
              {caption}
            </figcaption>
          </figure>
        </main>
      </div>

      <NewLibraryDialog
        key={libraryDialog.key}
        open={libraryDialog.open}
        replacing={library?.name ?? null}
        onClose={() => setLibraryDialog((d) => ({ ...d, open: false }))}
        onCreate={createLibrary}
      />
      <Dialog
        open={confirmSample}
        title={t.home.trySample}
        onClose={() => setConfirmSample(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmSample(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" onClick={openSample}>
              {t.common.confirm}
            </Button>
          </>
        }
      >
        <p className={styles.warning}>
          {format(t.home.replaceWarning, { name: library?.name ?? '' })}
        </p>
      </Dialog>
    </FileDrop>
  )
}
