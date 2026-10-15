import { format, useT } from '../../i18n/i18n.ts'
import { Button } from '../../ui/Button.tsx'
import styles from './LooseBanner.module.css'

interface LooseBannerProps {
  count: number
  libraryName: string
  onAdd(): void
  onLater(): void
}

/** Offers to move the paintings made outside a library into the open one. */
export function LooseBanner({ count, libraryName, onAdd, onLater }: LooseBannerProps) {
  const t = useT()
  return (
    <section className={styles.banner} aria-label={t.library.looseTitle}>
      <p className={styles.text}>
        {count === 1 ? t.library.looseBannerOne : format(t.library.looseBanner, { count })}
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onAdd}>
          {format(t.library.addLoose, { name: libraryName })}
        </Button>
        <Button variant="ghost" onClick={onLater}>
          {t.common.later}
        </Button>
      </div>
    </section>
  )
}
