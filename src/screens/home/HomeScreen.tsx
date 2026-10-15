import { useId, useMemo, useRef, useState } from 'react'
import type { Painting } from '../../domain/types.ts'
import { format, plural, useT } from '../../i18n/i18n.ts'
import { timeAgo, useMinuteClock } from '../../i18n/timeAgo.ts'
import { renderScene } from '../../imaging/scenes.ts'
import { hashString } from '../../imaging/shapes.ts'
import { renderWallPreview } from '../../imaging/wall.ts'
import { applyWindow } from '../../imaging/window.ts'
import { useNavigation } from '../../state/navigation.ts'
import { openSampleLibrary } from '../../state/sample.ts'
import { useThumbnail } from '../../state/thumbnails.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Button } from '../../ui/Button.tsx'
import { Icon, type IconName } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { TopBar } from '../../ui/TopBar.tsx'
import { useContentBox } from '../../ui/useContentBox.ts'
import { CloseLibraryDialog } from '../CloseLibraryDialog.tsx'
import { importPackFile } from '../packImport.ts'
import styles from './HomeScreen.module.css'
import { NewLibraryDialog } from './NewLibraryDialog.tsx'

const SHOWCASE = { width: 3, height: 4, ppb: 32 }
const SHOWCASE_FALLBACK_BOX = { width: 480, height: 576 }
const RESUME_THUMB = { width: 44, height: 44 }

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

/** The painting saved last, from the library and the loose paintings. */
function latestPainting(paintings: Painting[]): Painting | null {
  let latest: Painting | null = null
  for (const p of paintings) {
    if (!latest || Date.parse(p.updatedAt) > Date.parse(latest.updatedAt)) latest = p
  }
  return latest
}

/** The real thumbnail of the painting to resume (I19). */
function ResumeThumb({ painting }: { painting: Painting }) {
  const raster = useThumbnail(painting)
  return (
    <Backdrop kind="mid" className={styles.resumeThumb} aria-hidden="true">
      {raster && raster !== 'failed' ? (
        <PaintingCanvas raster={raster} fit={RESUME_THUMB} label="" />
      ) : (
        <Icon name="image" size={22} />
      )}
    </Backdrop>
  )
}

const STEPS: Array<{ icon: IconName; key: 'make' | 'collect' | 'export' }> = [
  { icon: 'image', key: 'make' },
  { icon: 'folder', key: 'collect' },
  { icon: 'download', key: 'export' },
]

/** Make a painting → collect them in a library → export one file for the server (I20). */
function HowItWorks() {
  const t = useT()
  const headingId = useId()
  return (
    <section className={styles.how} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.howHeading}>
        {t.home.how.heading}
      </h2>
      <ol className={styles.steps}>
        {STEPS.map(({ icon, key }) => (
          <li key={key} className={styles.step}>
            <Icon name={icon} size={24} className={styles.stepIcon} />
            <h3 className={styles.stepTitle}>{t.home.how[key].title}</h3>
            <p className={styles.stepText}>{t.home.how[key].text}</p>
          </li>
        ))}
      </ol>
      <p className={styles.howNote}>{t.home.how.pack}</p>
      <p className={styles.howNote}>{t.home.how.mod}</p>
    </section>
  )
}

export function HomeScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const loose = useWorkspace((s) => s.loose)
  const demo = useWorkspace((s) => s.demo)
  // The workspace autosaves, so whatever it holds now is the saved work to resume.
  const hasSavedWork = library !== null || loose.length > 0
  const [libraryDialog, setLibraryDialog] = useState<{ open: boolean; key: number }>({
    open: false,
    key: 0,
  })
  /** What the close-library confirm leads to, when it is open (R15). */
  const [replace, setReplace] = useState<
    { kind: 'sample' } | { kind: 'create'; name: string; namespace: string } | null
  >(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const ids = { create: useId(), createHint: useId(), resume: useId(), resumeDetail: useId() }
  const now = useMinuteClock()

  const showcase = useMemo(() => renderShowcase(), [])
  const [showcaseRef, showcaseBox] = useContentBox(SHOWCASE_FALLBACK_BOX)
  const latest = latestPainting([...(library?.paintings ?? []), ...loose])

  /** A new painting only enters the workspace once it is changed (R18). */
  function createPainting() {
    go({ name: 'editor', paintingId: null })
  }

  async function openPack(file: File) {
    if (await importPackFile(file)) go({ name: 'library' })
  }

  function resume() {
    const [only] = loose
    if (!library && loose.length === 1 && only) go({ name: 'editor', paintingId: only.id })
    else go({ name: 'library' })
  }

  function createLibrary(name: string, namespace: string) {
    setLibraryDialog((d) => ({ ...d, open: false }))
    // Replacing an open library asks first (R15).
    if (library) setReplace({ kind: 'create', name, namespace })
    else createNow(name, namespace)
  }

  function createNow(name: string, namespace: string) {
    useWorkspace.getState().createLibrary(name, namespace)
    go({ name: 'library' })
  }

  function openSample() {
    openSampleLibrary(t.home.sampleName, t.home.sampleTitles)
    go({ name: 'library' })
  }

  function trySample() {
    if (demo) go({ name: 'library' })
    else if (library) setReplace({ kind: 'sample' })
    else openSample()
  }

  function confirmReplace() {
    const next = replace
    setReplace(null)
    if (next?.kind === 'sample') openSample()
    else if (next?.kind === 'create') createNow(next.name, next.namespace)
  }

  const inProgress =
    (library?.paintings.filter((p) => p.status !== 'published').length ?? 0) + loose.length
  const resumeDetail = [
    library && format(t.home.resumeLibrary, { name: library.name, version: library.version }),
    inProgress > 0 && plural(t, t.home.inProgress, inProgress),
    latest && format(t.home.savedAgo, { time: timeAgo(latest.updatedAt, now, t) }),
  ]
    .filter(Boolean)
    .join(' · ')

  const caption = format(t.home.showcaseCaption, {
    shape: t.shapes.gothic_arch,
    width: SHOWCASE.width,
    height: SHOWCASE.height,
  })
  const [hintBefore = '', hintAfter = ''] = t.home.openPackHint.split('{file}')
  // Only an exported version is a file the player can have (I19).
  const packFile =
    library && library.version >= 1
      ? `${library.namespace}-v${library.version}.zip`
      : t.home.anyPackFile

  const resumeCard = hasSavedWork && (
    <button
      type="button"
      className={styles.resume}
      aria-labelledby={ids.resume}
      aria-describedby={ids.resumeDetail}
      onClick={resume}
    >
      {latest ? (
        <ResumeThumb painting={latest} />
      ) : (
        <Backdrop kind="mid" className={styles.resumeThumb} aria-hidden="true">
          <Icon name="folder" size={22} />
        </Backdrop>
      )}
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
      <span className={`${styles.faux} ${styles.fauxPrimary}`} aria-hidden="true">
        {t.home.resumeButton}
      </span>
    </button>
  )

  return (
    <>
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
            <p className={styles.lede}>{t.home.lede}</p>
            <p className={styles.privacy}>{t.home.privacy}</p>

            <div className={styles.actions}>
              {/* Returning players find their work first (I19). */}
              {resumeCard}
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
                    {/* A painting made with the demo open stays outside it (R23). */}
                    {library && !demo
                      ? format(t.home.createInLibrary, { name: library.name })
                      : t.home.createPaintingHint}
                  </span>
                  <span
                    className={`${styles.faux} ${hasSavedWork ? styles.fauxButton : styles.fauxPrimary}`}
                    aria-hidden="true"
                  >
                    <Icon name="plus" />
                    {t.home.startPainting}
                  </span>
                </button>

                <div className={`${styles.card} ${styles.dropCard}`}>
                  <Icon name="folder" size={30} className={styles.cardIcon} />
                  <p className={styles.cardTitle}>{t.home.openPack}</p>
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
                      const [file] = Array.from(event.target.files ?? [])
                      event.target.value = ''
                      if (file) void openPack(file)
                    }}
                  />
                </div>
              </div>

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

          <HowItWorks />
        </main>
      </div>

      <NewLibraryDialog
        key={libraryDialog.key}
        open={libraryDialog.open}
        replacing={library?.name ?? null}
        onClose={() => setLibraryDialog((d) => ({ ...d, open: false }))}
        onCreate={createLibrary}
      />
      <CloseLibraryDialog
        open={replace !== null}
        onCancel={() => setReplace(null)}
        onConfirm={confirmReplace}
        confirmLabel={replace?.kind === 'sample' ? t.home.closeForSample : t.home.closeForNew}
      />
    </>
  )
}
