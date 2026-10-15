import { useEffect, useId, useRef, useState } from 'react'
import { canDelete, isChanged, paintingState, readyToExport } from '../../domain/library.ts'
import type { Library, Painting } from '../../domain/types.ts'
import { format, plural, useT } from '../../i18n/i18n.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { errorMessage } from '../../ui/errors.ts'
import { Icon } from '../../ui/Icon.tsx'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import { CloseLibraryDialog } from '../CloseLibraryDialog.tsx'
import { NewLibraryDialog } from '../home/NewLibraryDialog.tsx'
import { importPackFile } from '../packImport.ts'
import styles from './LibraryScreen.module.css'
import { LooseSection } from './LooseSection.tsx'
import { PaintingCard } from './PaintingCard.tsx'

type Filter = 'all' | 'ready' | 'draft' | 'published'

/** The filter chips use the badges' words (R16); Published includes changed paintings. */
const FILTERS: Record<Filter, (p: Painting) => boolean> = {
  all: () => true,
  ready: (p) => p.status === 'ready',
  draft: (p) => p.status === 'draft',
  published: (p) => p.status === 'published',
}

/** How long a fresh duplicate stays outlined (I17). */
const HIGHLIGHT_MS = 2500

/** Lower case without accents, so "zoe" finds "Zoé". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function matches(p: Painting, query: string): boolean {
  const q = normalize(query.trim())
  return q === '' || normalize(p.title).includes(q) || normalize(p.author).includes(q)
}

/** "Export · 2 ready" (+ " · 1 changed"): what Export will pick by itself (R16, I25). */
function exportLabel(library: Library, t: ReturnType<typeof useT>) {
  const ready = readyToExport(library).length
  const changed = library.paintings.filter((p) => isChanged(p, library)).length
  const label = plural(t, t.library.exportReady, ready)
  return {
    label: changed > 0 ? `${label} · ${plural(t, t.library.exportChanged, changed)}` : label,
    worthIt: ready + changed > 0,
  }
}

export function LibraryScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const loose = useWorkspace((s) => s.loose)
  const demo = useWorkspace((s) => s.demo)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<Painting | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [libraryDialog, setLibraryDialog] = useState({ open: false, key: 0 })
  /** A new library waiting for the close-library confirm (R15). */
  const [replaceWith, setReplaceWith] = useState<{ name: string; namespace: string } | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const demoNoteId = useId()
  const emptyId = useId()

  const nothingToShow = !library && loose.length === 0
  useEffect(() => {
    if (nothingToShow) go({ name: 'home' }, { replace: true })
  }, [nothingToShow, go])
  useEffect(() => {
    if (highlight === null) return
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight])
  if (nothingToShow) return null

  const paintings = library ? library.paintings : loose
  const count = (f: Filter) => paintings.filter(FILTERS[f]).length
  const visible = paintings.filter((p) => FILTERS[filter](p) && matches(p, query))
  const exportButton = library && exportLabel(library, t)

  /** A new painting only enters the workspace once it is changed (R18). */
  function createPainting() {
    go({ name: 'editor', paintingId: null })
  }

  function addLoose(ids?: string[]) {
    const name = library?.name ?? ''
    const added = useWorkspace.getState().addLooseToLibrary(ids)
    toast(plural(t, t.library.looseAdded, added, { name }))
  }

  function duplicate(p: Painting) {
    try {
      const id = useWorkspace.getState().duplicatePainting(p.id, t.library.copySuffix)
      // The copy is ready: keep it in view whatever the filter (I17).
      setFilter((f) => (f === 'all' || f === 'ready' ? f : 'all'))
      setHighlight(id)
      toast(t.library.duplicated, 'info', {
        label: t.common.edit,
        run: () => go({ name: 'editor', paintingId: id }),
      })
    } catch (error) {
      toast(errorMessage(error, t), 'error')
    }
  }

  function confirmDelete() {
    if (!deleting) return
    try {
      useWorkspace.getState().deletePainting(deleting.id)
    } catch (error) {
      toast(errorMessage(error, t), 'error')
    }
    setDeleting(null)
  }

  function closeLibrary() {
    setConfirmClose(false)
    useWorkspace.getState().closeLibrary()
    go({ name: 'home' })
  }

  function createLibrary(name: string, namespace: string) {
    setLibraryDialog((d) => ({ ...d, open: false }))
    // From the demo banner: the demo is replaced, after asking (R15).
    if (library) setReplaceWith({ name, namespace })
    else useWorkspace.getState().createLibrary(name, namespace)
  }

  function confirmReplace() {
    if (replaceWith) useWorkspace.getState().createLibrary(replaceWith.name, replaceWith.namespace)
    setReplaceWith(null)
  }

  const openNewLibrary = () => setLibraryDialog((d) => ({ open: true, key: d.key + 1 }))
  const openPackPicker = () => fileInput.current?.click()

  const packInput = (
    <input
      ref={fileInput}
      type="file"
      accept=".zip,application/zip"
      hidden
      aria-label={library ? t.library.importPack : t.home.openPack}
      onChange={(event) => {
        const [file] = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (file) void importPackFile(file)
      }}
    />
  )

  const chip =
    library &&
    plural(t, t.library.chip, library.paintings.length, {
      name: library.name,
      version: library.version,
    })

  const deletingTitle = deleting ? deleting.title || t.library.untitled : ''
  const emptyLibrary = library !== null && library.paintings.length === 0

  const card = (p: Painting, headingLevel: 2 | 3, add?: boolean) => (
    <PaintingCard
      key={p.id}
      painting={p}
      state={paintingState(p, library)}
      headingLevel={headingLevel}
      highlighted={highlight === p.id}
      onEdit={() => go({ name: 'editor', paintingId: p.id })}
      onDuplicate={() => duplicate(p)}
      onDelete={canDelete(p) ? () => setDeleting(p) : undefined}
      add={
        // Nothing joins the demo: it can't be exported and closing it deletes it (R23).
        add && library && !demo
          ? {
              label: format(t.library.addLoose, { name: library.name }),
              onAdd: () => addLoose([p.id]),
            }
          : undefined
      }
    />
  )

  return (
    <div className={styles.page}>
      <TopBar
        onHome={() => go({ name: 'home' })}
        left={chip && <span className={styles.chip}>{chip}</span>}
        menu={
          library
            ? [
                { label: t.library.importPack, onSelect: openPackPicker },
                { label: t.library.closeLibrary, onSelect: () => setConfirmClose(true) },
              ]
            : []
        }
        right={
          exportButton && (
            <Button
              variant={exportButton.worthIt && !demo ? 'primary' : 'secondary'}
              disabled={demo}
              aria-describedby={demo ? demoNoteId : undefined}
              onClick={() => go({ name: 'export' })}
            >
              {exportButton.label}
            </Button>
          )
        }
      />
      {packInput}

      <main className={styles.library}>
        {library ? (
          <h1 className="visually-hidden">{library.name}</h1>
        ) : (
          <section className={styles.looseIntro}>
            <h1 className={styles.heading}>{t.library.looseTitle}</h1>
            <p className={styles.hint}>{t.library.looseHint}</p>
            <div className={styles.introActions}>
              <Button icon="folder" onClick={openPackPicker}>
                {t.home.openPack}
              </Button>
              <Button icon="plus" onClick={openNewLibrary}>
                {t.home.newLibrary}
              </Button>
            </div>
          </section>
        )}

        {library && demo && (
          <div className={styles.demo} role="note">
            <p id={demoNoteId}>{t.library.demoBanner}</p>
            <Button variant="primary" icon="plus" onClick={openNewLibrary}>
              {t.library.demoStart}
            </Button>
          </div>
        )}

        {emptyLibrary ? (
          <section className={styles.emptyState} aria-labelledby={emptyId}>
            <Icon name="image" size={48} className={styles.emptyIcon} />
            <h2 id={emptyId} className={styles.emptyTitle}>
              {t.library.empty}
            </h2>
            <p className={styles.hint}>{t.library.emptyHint}</p>
            <div className={styles.introActions}>
              <Button variant="primary" icon="plus" onClick={createPainting}>
                {t.library.newPainting}
              </Button>
              <Button icon="folder" onClick={openPackPicker}>
                {t.library.importAPack}
              </Button>
            </div>
          </section>
        ) : (
          <>
            <div className={styles.bar}>
              <div className={styles.filters} role="group" aria-label={t.library.filters}>
                {(
                  [
                    ['all', t.library.filterAll],
                    ['ready', t.library.filterReady],
                    ['draft', t.library.filterDraft],
                    ['published', t.library.filterPublished],
                  ] as const
                ).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    className={styles.filter}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {label} <span className={styles.count}>{count(f)}</span>
                  </button>
                ))}
              </div>
              <div className={styles.spacer} />
              <label className={styles.search}>
                <Icon name="search" className={styles.searchIcon} />
                <input
                  type="search"
                  className={styles.searchInput}
                  placeholder={t.library.search}
                  aria-label={t.library.search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <Button variant="primary" icon="plus" onClick={createPainting}>
                {t.library.newPainting}
              </Button>
            </div>

            <ul className={styles.grid} aria-label={t.library.grid}>
              {visible.map((p) => card(p, 2))}
            </ul>
            {visible.length === 0 && <p className={styles.empty}>{t.library.noMatches}</p>}
          </>
        )}

        {library && loose.length > 0 && (
          <LooseSection
            count={loose.length}
            libraryName={library.name}
            onAddAll={demo ? undefined : () => addLoose()}
          >
            {loose.map((p) => card(p, 3, true))}
          </LooseSection>
        )}
      </main>

      <Dialog
        open={deleting !== null}
        title={t.library.confirmDelete}
        onClose={() => setDeleting(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              {t.library.deletePainting}
            </Button>
          </>
        }
      >
        <p className={styles.warning}>
          {format(t.library.deleteWarning, { title: deletingTitle })}
        </p>
      </Dialog>

      <CloseLibraryDialog
        open={confirmClose}
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeLibrary}
      />
      <CloseLibraryDialog
        open={replaceWith !== null}
        onCancel={() => setReplaceWith(null)}
        onConfirm={confirmReplace}
        confirmLabel={t.home.closeForNew}
      />

      <NewLibraryDialog
        key={libraryDialog.key}
        open={libraryDialog.open}
        replacing={library?.name ?? null}
        onClose={() => setLibraryDialog((d) => ({ ...d, open: false }))}
        onCreate={createLibrary}
      />
    </div>
  )
}
