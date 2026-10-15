import { useEffect, useId, useRef, useState } from 'react'
import { ShapeError } from '../../domain/errors.ts'
import { exportSet, whatsNew } from '../../domain/library.ts'
import type { Assets, Library, Painting } from '../../domain/types.ts'
import { validateForExport, type Issue } from '../../domain/validate.ts'
import type { Dictionary } from '../../i18n/en.ts'
import { format, useT } from '../../i18n/i18n.ts'
import {
  serverPropertiesLines,
  writeLibraryPack,
  type LibraryPackResult,
} from '../../packs/libraryPack.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useThumbnail } from '../../state/thumbnails.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Button } from '../../ui/Button.tsx'
import { copyText, selectText } from '../../ui/clipboard.ts'
import { downloadBytes } from '../../ui/download.ts'
import { errorMessage } from '../../ui/errors.ts'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import styles from './ExportScreen.module.css'

/** Published paintings shown before the "+ n more published" toggle. */
const PUBLISHED_SHOWN = 5
const THUMB_BOX = { width: 36, height: 36 }

type Phase = { kind: 'choose' } | { kind: 'busy' } | { kind: 'done'; result: LibraryPackResult }

const isNew = (p: Painting) => p.status !== 'published'
const readyIds = (lib: Library) =>
  new Set(lib.paintings.filter((p) => p.status === 'ready').map((p) => p.id))
const titleOf = (p: Painting | undefined, t: Dictionary) =>
  p && p.title.trim() !== '' ? p.title : t.library.untitled

function issueMessage(issue: Issue, lib: Library, t: Dictionary): string {
  const painting = lib.paintings.find((p) => p.id === issue.paintingId)
  const values = { title: titleOf(painting, t), id: issue.paintingId ?? '' }
  switch (issue.code) {
    case 'no-image':
      return format(t.export.issue.noImage, values)
    case 'duplicate-id':
      return format(t.export.issue.duplicateId, values)
    case 'no-title':
      return format(t.export.issue.noTitle, values)
    case 'no-author':
      return format(t.export.issue.noAuthor, values)
    case 'nothing-new':
      return format(t.export.issue.nothingNew, { version: lib.version })
  }
}

function newsLine(p: Painting, t: Dictionary): string {
  const title = titleOf(p, t)
  return p.author.trim() === '' ? title : format(t.export.whatsNewItem, { title, author: p.author })
}

/** `**Library vN**` then one `- title by author` line per painting new in that version. */
function discordText(lib: Library, version: number, t: Dictionary): string {
  const news = whatsNew(lib, version)
  const lines = news.map((p) =>
    p.author.trim() === ''
      ? `- ${titleOf(p, t)}`
      : format(t.export.discordLine, { title: titleOf(p, t), author: p.author }),
  )
  if (lines.length === 0) lines.push(`- ${t.export.nothingNew}`)
  return [`**${lib.name} v${version}**`, ...lines].join('\n')
}

/** Publishes the selection now and builds the library pack. */
function buildPack(lib: Library, ids: string[], assets: Assets): Promise<LibraryPackResult> {
  return writeLibraryPack(lib, ids, assets, new Date())
}

const kilobytes = (bytes: number) => Math.max(1, Math.round(bytes / 1024))

function Thumb({ painting }: { painting: Painting }) {
  const raster = useThumbnail(painting)
  return (
    <Backdrop kind="mid" className={styles.thumb}>
      {raster && raster !== 'failed' ? (
        <PaintingCanvas raster={raster} fit={THUMB_BOX} label="" />
      ) : (
        <Icon name="image" size={18} className={styles.thumbIcon} />
      )}
    </Backdrop>
  )
}

interface PickProps {
  painting: Painting
  checked: boolean
  disabled: boolean
  meta: string
  hint?: string
  locked?: boolean
  onToggle?: () => void
}

function Pick({ painting, checked, disabled, meta, hint, locked, onToggle }: PickProps) {
  const t = useT()
  const titleId = useId()
  return (
    <li>
      <label className={`${styles.pick} ${locked ? styles.locked : ''}`}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          disabled={disabled}
          aria-labelledby={titleId}
          onChange={onToggle}
        />
        {locked && <Icon name="lock" size={12} className={styles.lockIcon} />}
        <Thumb painting={painting} />
        <span className={styles.pickText}>
          <b id={titleId}>{titleOf(painting, t)}</b>
          <span className={styles.muted}>{meta}</span>
          {hint && <span className={styles.hint}>{hint}</span>}
        </span>
      </label>
    </li>
  )
}

function CopyButton({
  label,
  onCopy,
  disabled,
}: {
  label: string
  onCopy(): void
  disabled?: boolean
}) {
  const t = useT()
  return (
    <Button icon="copy" aria-label={label} onClick={onCopy} disabled={disabled}>
      {t.common.copy}
    </Button>
  )
}

export function ExportScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const hasLoose = useWorkspace((s) => s.loose.length > 0)

  useEffect(() => {
    if (library) return
    // StrictMode runs effects twice; only the first run still sees the export screen.
    if (useNavigation.getState().screen.name !== 'export') return
    toast(t.export.needsLibrary)
    go(hasLoose ? { name: 'library' } : { name: 'home' })
  }, [library, hasLoose, go, t])

  if (!library) return null
  return <ExportView library={library} />
}

function ExportView({ library }: { library: Library }) {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const assets = useWorkspace((s) => s.assets)
  const [selected, setSelected] = useState(() => readyIds(library))
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })
  const [showAllPublished, setShowAllPublished] = useState(false)
  const sha1Ref = useRef<HTMLElement>(null)
  const propertiesRef = useRef<HTMLPreElement>(null)

  const newPaintings = library.paintings.filter(isNew)
  const published = library.paintings.filter((p) => !isNew(p))
  const selectedIds = newPaintings.filter((p) => selected.has(p.id)).map((p) => p.id)
  const done = phase.kind === 'done' ? phase.result : null
  const busy = phase.kind === 'busy'

  const issues = done ? [] : validateForExport(library, selectedIds, assets)
  const blocking = issues.some((i) => i.blocking)
  const fromVersion = done ? done.library.version - 1 : library.version
  const toVersion = fromVersion + 1
  const total = done ? exportSet(done.library, []).length : exportSet(library, selectedIds).length
  const news = done
    ? whatsNew(done.library, done.library.version)
    : newPaintings.filter((p) => selected.has(p.id))
  const fileName = done ? done.fileName : `${library.namespace}-v${toVersion}.zip`
  const ns = library.namespace

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runExport() {
    const state = useWorkspace.getState()
    if (!state.library) return
    setPhase({ kind: 'busy' })
    // Let the busy state paint before the synchronous rendering work starts.
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      const result = await buildPack(state.library, selectedIds, state.assets)
      downloadBytes(result.bytes, result.fileName, 'application/zip')
      useWorkspace.getState().applyExport(result.library)
      setPhase({ kind: 'done', result })
    } catch (error) {
      if (error instanceof ShapeError && error.code === 'export-failed') {
        // The message is developer text in English; players get a translated reason.
        console.error('Export failed', error)
        toast(errorMessage(error, t, { reason: t.export.failedReason }), 'error')
      } else {
        toast(errorMessage(error, t), 'error')
      }
      setPhase({ kind: 'choose' })
    }
  }

  function startAgain() {
    setSelected(readyIds(useWorkspace.getState().library ?? library))
    setPhase({ kind: 'choose' })
  }

  async function copy(text: string, source: HTMLElement | null) {
    if (await copyText(text)) {
      toast(t.common.copied)
    } else {
      if (source) selectText(source)
      toast(t.export.copyFailed, 'error')
    }
  }

  const visiblePublished = showAllPublished ? published : published.slice(0, PUBLISHED_SHOWN)
  const hiddenCount = published.length - PUBLISHED_SHOWN

  let checks = { label: t.export.checksPassed, tone: styles.ok }
  if (blocking) checks = { label: t.export.checksBlocked, tone: styles.danger }
  else if (issues.length > 0) checks = { label: t.export.checksWarnings, tone: styles.warn }

  const properties = serverPropertiesLines(done ? done.sha1 : '…')

  return (
    <div className={styles.page}>
      <TopBar
        left={
          <div className={styles.topLeft}>
            <Button variant="ghost" icon="arrow-left" onClick={() => go({ name: 'library' })}>
              {t.export.back}
            </Button>
            <h1 className={styles.heading}>{format(t.export.heading, { name: library.name })}</h1>
          </div>
        }
        right={!done && <span className={`${styles.chip} ${checks.tone}`}>{checks.label}</span>}
      />
      <main className={styles.columns}>
        <section className={styles.panel} aria-labelledby="export-what">
          <h2 id="export-what" className={styles.h2}>
            {t.export.whatGoesIn}
          </h2>
          <h3 className={styles.label}>{t.export.newChoose}</h3>
          {newPaintings.length === 0 ? (
            <p className={styles.muted}>{t.export.noNew}</p>
          ) : (
            <ul className={styles.picks}>
              {newPaintings.map((p) => (
                <Pick
                  key={p.id}
                  painting={p}
                  checked={selected.has(p.id)}
                  disabled={phase.kind !== 'choose'}
                  meta={format(t.export.pickMeta, {
                    author: p.author,
                    width: p.width,
                    height: p.height,
                  })}
                  hint={p.status === 'draft' ? t.export.draftNotReady : undefined}
                  onToggle={() => toggle(p.id)}
                />
              ))}
            </ul>
          )}
          {published.length > 0 && (
            <>
              <h3 className={styles.label}>{t.export.publishedAlways}</h3>
              <ul className={styles.picks}>
                {visiblePublished.map((p) => (
                  <Pick
                    key={p.id}
                    painting={p}
                    checked
                    disabled
                    locked
                    meta={
                      p.publishedIn === undefined
                        ? ''
                        : format(t.export.since, { version: p.publishedIn })
                    }
                  />
                ))}
              </ul>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => setShowAllPublished((v) => !v)}
                >
                  {showAllPublished
                    ? t.export.showLess
                    : format(t.export.morePublished, { count: hiddenCount })}
                </button>
              )}
            </>
          )}
        </section>

        <section className={styles.panel} aria-label={t.export.downloadPack}>
          <div className={styles.version}>
            <span className={styles.muted}>
              {format(t.export.version, { version: fromVersion })}
            </span>
            <span aria-hidden="true">→</span>
            <span className={styles.accent}>
              {format(t.export.version, { version: toVersion })}
            </span>
            <small className={styles.counts}>
              <span>
                {news.length === 1
                  ? t.export.newCountOne
                  : format(t.export.newCount, { count: news.length })}
              </span>
              <span>{format(t.export.totalCount, { count: total })}</span>
            </small>
          </div>

          <div className={styles.file}>
            <Icon name="download" size={26} />
            <div className={styles.fileText}>
              <b>{fileName}</b>
              <span className={styles.muted}>
                {done
                  ? format(t.export.fileHintSize, {
                      size: format(t.export.kilobytes, { size: kilobytes(done.bytes.length) }),
                    })
                  : t.export.fileHint}
              </span>
            </div>
          </div>

          <dl className={styles.inside} aria-label={t.export.inside}>
            <div>
              <dt>{t.export.insideLibrary}</dt>
              <dd>{format(t.export.insideLibraryDetail, { count: library.paintings.length })}</dd>
            </div>
            <div>
              <dt>{t.export.insideDatapack}</dt>
              <dd>{`${ns}-datapack.zip`}</dd>
            </div>
            <div>
              <dt>{t.export.insideResources}</dt>
              <dd>{`${ns}-resources.zip`}</dd>
            </div>
            <div>
              <dt>{t.export.insideSha1}</dt>
              <dd>{t.export.insideSha1Detail}</dd>
            </div>
          </dl>

          {issues.length > 0 && (
            <ul className={styles.issues} aria-label={t.export.issues}>
              {issues.map((issue, i) => (
                <li
                  key={`${issue.code}:${issue.paintingId ?? i}`}
                  className={issue.blocking ? styles.blocking : styles.warning}
                >
                  {issueMessage(issue, library, t)}
                </li>
              ))}
            </ul>
          )}

          {done ? (
            <div className={styles.done} role="status">
              <p>
                <Icon name="check" size={16} className={styles.okIcon} />{' '}
                {format(t.export.done, { file: done.fileName })}
              </p>
              <div className={styles.row}>
                <Button
                  icon="download"
                  onClick={() => downloadBytes(done.bytes, done.fileName, 'application/zip')}
                >
                  {t.export.downloadAgain}
                </Button>
                <Button variant="ghost" onClick={startAgain}>
                  {t.export.exportAgain}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                icon="download"
                className={styles.download}
                disabled={blocking || busy}
                aria-busy={busy}
                onClick={() => void runExport()}
              >
                {busy ? t.export.exporting : t.export.downloadPack}
              </Button>
              {blocking && <p className={styles.blockedHint}>{t.export.blockedHint}</p>}
            </>
          )}

          <h3 className={styles.label}>{format(t.export.whatsNew, { version: toVersion })}</h3>
          {news.length === 0 ? (
            <p className={styles.muted}>{t.export.nothingNew}</p>
          ) : (
            <ul className={styles.news}>
              {news.map((p) => (
                <li key={p.id}>{newsLine(p, t)}</li>
              ))}
            </ul>
          )}
          {done && (
            <Button
              icon="copy"
              className={styles.discord}
              onClick={() => void copy(discordText(done.library, done.library.version, t), null)}
            >
              {t.export.copyDiscord}
            </Button>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="export-server">
          <h2 id="export-server" className={styles.h2}>
            {t.export.putOnServer}
          </h2>
          <h3 className={styles.label}>{t.export.sha1Label}</h3>
          <div className={styles.row}>
            {done ? (
              <code ref={sha1Ref} className={styles.code} data-testid="sha1">
                {done.sha1}
              </code>
            ) : (
              <span className={`${styles.code} ${styles.pending}`}>{t.export.sha1Pending}</span>
            )}
            <CopyButton
              label={t.export.copySha1}
              disabled={!done}
              onCopy={() => done && void copy(done.sha1, sha1Ref.current)}
            />
          </div>
          <h3 className={styles.label}>{t.export.serverProperties}</h3>
          <pre ref={propertiesRef} className={styles.code} data-testid="server-properties">
            {properties}
          </pre>
          <div>
            <CopyButton
              label={t.export.copyProperties}
              disabled={!done}
              onCopy={() => void copy(properties, propertiesRef.current)}
            />
          </div>
          <ol className={styles.steps}>
            <li>{t.export.serverSteps.step1}</li>
            <li>{t.export.serverSteps.step2}</li>
            <li>{t.export.serverSteps.step3}</li>
            <li>{t.export.serverSteps.step4}</li>
          </ol>
          <p className={styles.never} role="note">
            {t.export.neverDelete}
          </p>
        </section>
      </main>
    </div>
  )
}
