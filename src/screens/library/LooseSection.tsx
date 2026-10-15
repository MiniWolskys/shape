import { useId, useState, type ReactNode } from 'react'
import { plural, useT } from '../../i18n/i18n.ts'
import { Button } from '../../ui/Button.tsx'
import styles from './LooseSection.module.css'

/** Folded away for this page session; the section itself always stays (I16). */
let folded = false

interface LooseSectionProps {
  count: number
  libraryName: string
  /** Absent when they can't join the open library (the demo). */
  onAddAll?: () => void
  /** The loose paintings' cards. */
  children: ReactNode
}

/**
 * The paintings made outside a library, listed under the open one (I16), each with its own
 * "Add to {library}". It can be folded but never dismissed, so they stay one click away.
 */
export function LooseSection({ count, libraryName, onAddAll, children }: LooseSectionProps) {
  const t = useT()
  const headingId = useId()
  const listId = useId()
  const [open, setOpen] = useState(!folded)

  function toggle() {
    folded = open
    setOpen(!open)
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.banner}>
        <div className={styles.text}>
          <h2 id={headingId} className={styles.heading}>
            {t.library.looseSection}
          </h2>
          <p className={styles.detail}>
            {plural(t, t.library.looseBanner, count, { name: libraryName })}
          </p>
        </div>
        <div className={styles.actions}>
          {onAddAll && (
            <Button variant="primary" onClick={onAddAll}>
              {plural(t, t.library.addAllLoose, count, { name: libraryName })}
            </Button>
          )}
          <Button
            variant="ghost"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={toggle}
          >
            {open ? t.library.hideLoose : t.library.showLoose}
          </Button>
        </div>
      </div>
      {open && (
        <ul id={listId} className={styles.grid} aria-label={t.library.looseSection}>
          {children}
        </ul>
      )}
    </section>
  )
}
