import { useId, useState } from 'react'
import { isChanged } from '../../domain/library.ts'
import type { Library, Painting } from '../../domain/types.ts'
import { format, plural, useT } from '../../i18n/i18n.ts'
import { useThumbnail } from '../../state/thumbnails.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { pickMeta, titleOf } from './exportText.ts'
import styles from './ExportScreen.module.css'

/** Published paintings shown before the "+ n more published" toggle. */
const PUBLISHED_SHOWN = 5
const THUMB_BOX = { width: 36, height: 36 }

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
        {/* The lock sits with the checkbox it explains (M8). */}
        <span className={styles.checkCell}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={checked}
            disabled={disabled}
            aria-labelledby={titleId}
            onChange={onToggle}
          />
          {locked && <Icon name="lock" size={12} className={styles.lockIcon} />}
        </span>
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

interface SelectionPanelProps {
  library: Library
  selected: ReadonlySet<string>
  /** Ticking is closed while the pack builds and once it is done. */
  locked: boolean
  onToggle(id: string): void
}

/** What goes in: new paintings to tick, then changed and published ones (always in). */
export function SelectionPanel({ library, selected, locked, onToggle }: SelectionPanelProps) {
  const t = useT()
  const ids = { what: useId(), changed: useId(), published: useId() }
  const [showAllPublished, setShowAllPublished] = useState(false)
  const unpublished = library.paintings.filter((p) => p.status !== 'published')
  const changed = library.paintings.filter((p) => isChanged(p, library))
  const published = library.paintings.filter(
    (p) => p.status === 'published' && !isChanged(p, library),
  )
  const visiblePublished = showAllPublished ? published : published.slice(0, PUBLISHED_SHOWN)
  const hiddenCount = published.length - PUBLISHED_SHOWN
  const since = (p: Painting) =>
    p.publishedIn === undefined ? '' : format(t.export.since, { version: p.publishedIn })

  return (
    <section className={styles.panel} aria-labelledby={ids.what}>
      <h2 id={ids.what} className={styles.h2}>
        {t.export.whatGoesIn}
      </h2>
      <h3 className={styles.label}>{t.export.newChoose}</h3>
      {unpublished.length === 0 ? (
        <p className={styles.muted}>{t.export.noNew}</p>
      ) : (
        <ul className={styles.picks} aria-label={t.export.newChoose}>
          {unpublished.map((p) => (
            <Pick
              key={p.id}
              painting={p}
              checked={selected.has(p.id)}
              disabled={locked}
              meta={pickMeta(p, t)}
              hint={p.status === 'draft' ? t.export.draftNotReady : undefined}
              onToggle={() => onToggle(p.id)}
            />
          ))}
        </ul>
      )}
      {changed.length > 0 && (
        <>
          <h3 id={ids.changed} className={styles.label}>
            {format(t.export.changedSince, { version: library.version })}
          </h3>
          <ul className={styles.picks} aria-labelledby={ids.changed}>
            {changed.map((p) => (
              <Pick
                key={p.id}
                painting={p}
                checked
                disabled
                locked
                meta={since(p)}
                hint={t.export.changedHint}
              />
            ))}
          </ul>
        </>
      )}
      {published.length > 0 && (
        <>
          <h3 id={ids.published} className={styles.label}>
            {t.export.publishedAlways}
          </h3>
          <ul className={styles.picks} aria-labelledby={ids.published}>
            {visiblePublished.map((p) => (
              <Pick key={p.id} painting={p} checked disabled locked meta={since(p)} />
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
                : plural(t, t.export.morePublished, hiddenCount)}
            </button>
          )}
        </>
      )}
    </section>
  )
}
