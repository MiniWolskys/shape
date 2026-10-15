import type { ReactNode } from 'react'
import { useT } from '../i18n/i18n.ts'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import styles from './TopBar.module.css'

interface TopBarProps {
  left?: ReactNode
  right?: ReactNode
}

export function TopBar({ left, right }: TopBarProps) {
  const t = useT()
  return (
    <header className={styles.bar}>
      <div className={styles.logo}>
        <img className={styles.mark} src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <span className={styles.name}>{t.app.name}</span>
        <span className={styles.tagline}>{t.app.tagline}</span>
      </div>
      {left}
      <div className={styles.spacer} />
      {right}
      <LanguageSwitch />
    </header>
  )
}
