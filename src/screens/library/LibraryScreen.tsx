import { useEffect, useRef, useState } from 'react'
import { canDelete } from '../../domain/library.ts'
import type { Painting } from '../../domain/types.ts'
import { format, useT } from '../../i18n/i18n.ts'
import { useNavigation } from '../../state/navigation.ts'
import { useWorkspace } from '../../state/workspace.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { errorMessage } from '../../ui/errors.ts'
import { Icon } from '../../ui/Icon.tsx'
import { toast } from '../../ui/toastStore.ts'
import { TopBar } from '../../ui/TopBar.tsx'
import { NewLibraryDialog } from '../home/NewLibraryDialog.tsx'
import styles from './LibraryScreen.module.css'
import { LooseBanner } from './LooseBanner.tsx'
import { PaintingCard } from './PaintingCard.tsx'

type Filter = 'all' | 'new' | 'published'

const isPublished = (p: Painting) => p.status === 'published'

const FILTERS: Record<Filter, (p: Painting) => boolean> = {
  all: () => true,
  new: (p) => !isPublished(p),
  published: isPublished,
}

/** Lower case without accents, so "zoe" finds "Zoé". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function matches(p: Painting, query: string): boolean {
  const q = normalize(query.trim())
  return q === '' || normalize(p.title).includes(q) || normalize(p.author).includes(q)
}

export function LibraryScreen() {
  const t = useT()
  const go = useNavigation((s) => s.go)
  const library = useWorkspace((s) => s.library)
  const loose = useWorkspace((s) => s.loose)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [looseLater, setLooseLater] = useState(false)
  const [deleting, setDeleting] = useState<Painting | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [libraryDialog, setLibraryDialog] = useState({ open: false, key: 0 })
  const fileInput = useRef<HTMLInputElement>(null)

  const nothingToShow = !library && loose.length === 0
  useEffect(() => {
    if (nothingToShow) go({ name: 'home' })
  }, [nothingToShow, go])
  if (nothingToShow) return null

  const paintings = library ? library.paintings : loose
  const count = (f: Filter) => paintings.filter(FILTERS[f]).length
  const visible = paintings.filter((p) => FILTERS[filter](p) && matches(p, query))
  const newCount = library ? library.paintings.filter(FILTERS.new).length : 0

  function createPainting() {
    const paintingId = useWorkspace.getState().createPainting()
    go({ name: 'editor', paintingId })
  }

  async function openPack(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { added } = useWorkspace.getState().openLibraryPack(bytes)
      toast(added === 1 ? t.home.packAddedOne : format(t.home.packAdded, { count: added }))
    } catch (error) {
      const namespace = useWorkspace.getState().library?.namespace ?? ''
      toast(errorMessage(error, t, { namespace }), 'error')
    }
  }

  function addLoose() {
    const name = library?.name ?? ''
    const added = useWorkspace.getState().addLooseToLibrary()
    toast(
      added === 1
        ? format(t.library.looseAddedOne, { name })
        : format(t.library.looseAdded, { count: added, name }),
    )
  }

  function duplicate(p: Painting) {
    try {
      useWorkspace.getState().duplicatePainting(p.id)
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
    useWorkspace.getState().createLibrary(name, namespace)
    setLibraryDialog((d) => ({ ...d, open: false }))
  }

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
        if (file) void openPack(file)
      }}
    />
  )

  const chip =
    library &&
    (library.paintings.length === 1
      ? format(t.library.chipOne, { name: library.name, version: library.version })
      : format(t.library.chip, {
          name: library.name,
          version: library.version,
          count: library.paintings.length,
        }))

  const deletingTitle = deleting ? deleting.title || t.library.untitled : ''

  return (
    <div className={styles.page}>
      <TopBar
        left={chip && <span className={styles.chip}>{chip}</span>}
        right={
          library && (
            <div className={styles.topActions}>
              <Button variant="ghost" onClick={() => fileInput.current?.click()}>
                {t.library.importPack}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClose(true)}>
                {t.library.closeLibrary}
              </Button>
              <Button variant="primary" onClick={() => go({ name: 'export' })}>
                {format(t.library.exportNew, { count: newCount })}
              </Button>
            </div>
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
              <Button icon="folder" onClick={() => fileInput.current?.click()}>
                {t.home.openPack}
              </Button>
              <Button
                icon="plus"
                onClick={() => setLibraryDialog((d) => ({ open: true, key: d.key + 1 }))}
              >
                {t.home.newLibrary}
              </Button>
            </div>
          </section>
        )}

        {library && loose.length > 0 && !looseLater && (
          <LooseBanner
            count={loose.length}
            libraryName={library.name}
            onAdd={addLoose}
            onLater={() => setLooseLater(true)}
          />
        )}

        <div className={styles.bar}>
          <div className={styles.filters} role="group" aria-label={t.library.filters}>
            {(
              [
                ['all', t.library.filterAll],
                ['new', t.library.filterNew],
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
          {visible.map((p) => (
            <PaintingCard
              key={p.id}
              painting={p}
              onEdit={() => go({ name: 'editor', paintingId: p.id })}
              onDuplicate={() => duplicate(p)}
              onDelete={canDelete(p) ? () => setDeleting(p) : undefined}
            />
          ))}
        </ul>
        {visible.length === 0 && (
          <p className={styles.empty}>
            {paintings.length === 0 ? t.library.empty : t.library.noMatches}
          </p>
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
            <Button variant="primary" onClick={confirmDelete}>
              {t.common.delete}
            </Button>
          </>
        }
      >
        <p className={styles.warning}>
          {format(t.library.deleteWarning, { title: deletingTitle })}
        </p>
      </Dialog>

      <Dialog
        open={confirmClose}
        title={t.library.closeLibrary}
        onClose={() => setConfirmClose(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" onClick={closeLibrary}>
              {t.library.closeLibrary}
            </Button>
          </>
        }
      >
        <p className={styles.warning}>
          {format(t.library.closeWarning, { name: library?.name ?? '' })}
        </p>
      </Dialog>

      <NewLibraryDialog
        key={libraryDialog.key}
        open={libraryDialog.open}
        replacing={null}
        onClose={() => setLibraryDialog((d) => ({ ...d, open: false }))}
        onCreate={createLibrary}
      />
    </div>
  )
}
