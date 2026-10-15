import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Painting } from '../../domain/types.ts'
import { format, useT } from '../../i18n/i18n.ts'
import { useThumbnail } from '../../state/thumbnails.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import styles from './PaintingCard.module.css'

const THUMB_BOX = { width: 160, height: 140 }

interface PaintingCardProps {
  painting: Painting
  onEdit(): void
  onDuplicate(): void
  /** Absent when the painting cannot be deleted. */
  onDelete?: () => void
}

function Badge({ painting }: { painting: Painting }) {
  const t = useT()
  if (painting.status === 'published') {
    return (
      <span className={`${styles.badge} ${styles.published}`}>
        <Icon name="lock" size={11} />
        {t.library.badge.published}
      </span>
    )
  }
  if (painting.status === 'ready') {
    return <span className={`${styles.badge} ${styles.new}`}>{t.library.badge.new}</span>
  }
  return <span className={`${styles.badge} ${styles.draft}`}>{t.library.badge.draft}</span>
}

function Thumbnail({ painting, label }: { painting: Painting; label: string }) {
  const raster = useThumbnail(painting)
  return (
    <Backdrop kind="mid" className={styles.thumb}>
      {raster === 'failed' ? (
        <Icon name="image" size={40} className={styles.failed} />
      ) : raster ? (
        <PaintingCanvas raster={raster} fit={THUMB_BOX} label={label} />
      ) : (
        <span className={styles.skeleton} aria-hidden="true" />
      )}
    </Backdrop>
  )
}

interface CardMenuProps {
  title: string
  items: Array<{ label: string; onSelect(): void; danger?: boolean }>
}

/** The "⋯" button and its menu. Escape or a click elsewhere closes it; focus goes back. */
function CardMenu({ title, items }: CardMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const index = entries.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      event.preventDefault()
      entries[(to + entries.length) % entries.length]?.focus()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(entries.length - 1)
    else if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className={styles.menuWrap}>
      <button
        ref={button}
        type="button"
        className={styles.menuButton}
        aria-label={format(t.library.actionsFor, { title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={format(t.library.actionsFor, { title })}
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? `${styles.menuItem} ${styles.danger}` : styles.menuItem}
              onClick={() => {
                close()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PaintingCard({ painting, onEdit, onDuplicate, onDelete }: PaintingCardProps) {
  const t = useT()
  const title = painting.title || t.library.untitled
  const size = { width: painting.width, height: painting.height }
  const meta = painting.author
    ? format(t.library.cardMeta, { author: painting.author, ...size })
    : format(t.library.cardSize, size)
  const items = [
    { label: t.common.edit, onSelect: onEdit },
    { label: t.common.duplicate, onSelect: onDuplicate },
    ...(onDelete ? [{ label: t.common.delete, onSelect: onDelete, danger: true }] : []),
  ]

  return (
    <li className={styles.card}>
      <Thumbnail painting={painting} label={title} />
      <div className={styles.meta}>
        <h3 className={styles.title}>
          {/* Its ::after stretches over the whole card, so the card opens the editor. */}
          <button type="button" className={styles.open} onClick={onEdit}>
            {title}
          </button>
        </h3>
        <div className={styles.row}>
          <span className={styles.detail}>{meta}</span>
          <Badge painting={painting} />
        </div>
      </div>
      <CardMenu title={title} items={items} />
    </li>
  )
}
