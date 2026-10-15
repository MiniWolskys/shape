import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { PaintingState } from '../../domain/library.ts'
import type { Painting } from '../../domain/types.ts'
import { format, useT } from '../../i18n/i18n.ts'
import { useThumbnail } from '../../state/thumbnails.ts'
import { Backdrop } from '../../ui/Backdrop.tsx'
import { Button } from '../../ui/Button.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { PaintingCanvas } from '../../ui/PaintingCanvas.tsx'
import { useContentBox } from '../../ui/useContentBox.ts'
import styles from './PaintingCard.module.css'

/** Room around the thumbnail inside its area. */
const THUMB_PADDING = 12
const THUMB_FALLBACK = { width: 200, height: 170 }

interface PaintingCardProps {
  painting: Painting
  /** The badge: Draft, Ready, Changed or Published (R16). */
  state: PaintingState
  /** 2 in the main grid, 3 under a section heading. */
  headingLevel?: 2 | 3
  /** Briefly outlined and scrolled into view, e.g. a fresh duplicate (I17). */
  highlighted?: boolean
  onEdit(): void
  onDuplicate(): void
  /** Absent when the painting cannot be deleted: the menu then says why (M10). */
  onDelete?: () => void
  /** A loose painting's "Add to {library}" (I16). */
  add?: { label: string; onAdd(): void }
}

function Badge({ state }: { state: PaintingState }) {
  const t = useT()
  return (
    <span className={`${styles.badge} ${styles[state]}`}>
      {state === 'published' && <Icon name="lock" size={11} />}
      {t.library.badge[state]}
    </span>
  )
}

/** The painting, as big as its area allows: whole-number scale when enlarging (N7). */
function Thumbnail({ painting, label }: { painting: Painting; label: string }) {
  const raster = useThumbnail(painting)
  const [ref, box] = useContentBox(THUMB_FALLBACK)
  const fit = {
    width: Math.max(1, box.width - 2 * THUMB_PADDING),
    height: Math.max(1, box.height - 2 * THUMB_PADDING),
  }
  return (
    <Backdrop kind="mid" className={styles.thumb} ref={ref}>
      {raster === 'failed' ? (
        <Icon name="image" size={40} className={styles.failed} />
      ) : raster ? (
        <PaintingCanvas raster={raster} fit={fit} label={label} />
      ) : (
        <span className={styles.skeleton} aria-hidden="true" />
      )}
    </Backdrop>
  )
}

interface MenuItem {
  label: string
  onSelect(): void
  danger?: boolean
  /** Shown but not usable; the label says why. */
  disabled?: boolean
}

interface CardMenuProps {
  title: string
  items: MenuItem[]
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
              aria-disabled={item.disabled || undefined}
              className={[
                styles.menuItem,
                item.danger && styles.danger,
                item.disabled && styles.disabledItem,
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (item.disabled) return
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

export function PaintingCard({
  painting,
  state,
  headingLevel = 2,
  highlighted = false,
  onEdit,
  onDuplicate,
  onDelete,
  add,
}: PaintingCardProps) {
  const t = useT()
  const card = useRef<HTMLLIElement>(null)
  const title = painting.title || t.library.untitled
  const size = { width: painting.width, height: painting.height }
  const meta = painting.author
    ? format(t.library.cardMeta, { author: painting.author, ...size })
    : format(t.library.cardSize, size)
  const items: MenuItem[] = [
    { label: t.common.edit, onSelect: onEdit },
    { label: t.common.duplicate, onSelect: onDuplicate },
    onDelete
      ? { label: t.common.delete, onSelect: onDelete, danger: true }
      : { label: t.library.deleteLocked, onSelect: () => {}, disabled: true },
  ]
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [highlighted])

  return (
    <li ref={card} className={styles.card} data-highlight={highlighted || undefined}>
      <Thumbnail painting={painting} label={title} />
      <div className={styles.meta}>
        <Heading className={styles.title}>
          {/* Its ::after stretches over the whole card, so the card opens the editor. */}
          <button type="button" className={styles.open} onClick={onEdit}>
            {title}
          </button>
        </Heading>
        <div className={styles.row}>
          <span className={styles.detail}>{meta}</span>
          <Badge state={state} />
        </div>
        {add && (
          <Button icon="plus" className={styles.add} onClick={add.onAdd}>
            {add.label}
          </Button>
        )}
      </div>
      <CardMenu title={title} items={items} />
    </li>
  )
}
