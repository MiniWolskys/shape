import type { ReactNode } from 'react'
import { format, useT } from '../i18n/i18n.ts'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import styles from './TopBar.module.css'

interface TopBarProps {
  left?: ReactNode
  right?: ReactNode
  /** Makes the logo a button back to the home screen. */
  onHome?(): void
  /** Keeps that button visible but unusable (work in progress must not be left). */
  homeDisabled?: boolean
}

export function TopBar({ left, right, onHome, homeDisabled }: TopBarProps) {
  const t = useT()
  const logo = (
    <>
      <img className={styles.mark} src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      <span className={styles.name}>{t.app.name}</span>
      <span className={styles.tagline}>{t.app.tagline}</span>
    </>
  )
  return (
    <header className={styles.bar}>
      {onHome ? (
        <button
          type="button"
          className={`${styles.logo} ${styles.homeButton}`}
          aria-label={format(t.app.home, { name: t.app.name })}
          title={format(t.app.home, { name: t.app.name })}
          disabled={homeDisabled}
          onClick={onHome}
        >
          {logo}
        </button>
      ) : (
        <div className={styles.logo}>{logo}</div>
      )}
      {left}
      <div className={styles.spacer} />
      {right}
      <LanguageSwitch />
    </header>
  )
}
