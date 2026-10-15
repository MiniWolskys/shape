import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { format, useLanguage, useT, type Language } from '../i18n/i18n.ts'
import { Button } from './Button.tsx'
import { LanguageSwitch } from './LanguageSwitch.tsx'
import styles from './TopBar.module.css'
import { NARROW, useMediaQuery } from './useMediaQuery.ts'

/** A secondary action of a screen: a ghost button in the bar, an item of "⋯" on phones. */
export interface MenuAction {
  label: string
  onSelect(): void
}

interface TopBarProps {
  left?: ReactNode
  /** The screen's main actions, always in the bar. */
  right?: ReactNode
  /** Secondary actions, shown before `right`; folded into the "⋯" menu on narrow screens. */
  menu?: MenuAction[]
  /** Makes the logo a button back to the home screen. */
  onHome?(): void
  /** Keeps that button visible but unusable (work in progress must not be left). */
  homeDisabled?: boolean
}

/** Each language in its own name: a player who can't read the current one still finds theirs. */
const LANGUAGES: Array<{ value: Language; name: string }> = [
  { value: 'en', name: 'English' },
  { value: 'fr', name: 'Français' },
]

/** The "⋯" menu of narrow screens: the secondary actions, then the languages (I24). */
function MoreMenu({ actions }: { actions: MenuAction[] }) {
  const t = useT()
  const language = useLanguage((s) => s.language)
  const setLanguage = useLanguage((s) => s.setLanguage)
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || !wrapper.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Escape closes the menu only, not whatever the screen does with it.
      event.preventDefault()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** Arrow keys, Home and End move between the items. */
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = items()
    const index = all.indexOf(document.activeElement as HTMLElement)
    let next: number
    if (event.key === 'ArrowDown') next = (index + 1) % all.length
    else if (event.key === 'ArrowUp') next = (index - 1 + all.length) % all.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = all.length - 1
    else return
    event.preventDefault()
    all[next]?.focus()
  }

  function choose(run: () => void) {
    setOpen(false)
    button.current?.focus()
    run()
  }

  return (
    <div ref={wrapper} className={styles.more}>
      <button
        ref={button}
        type="button"
        className={styles.moreButton}
        aria-label={t.common.more}
        title={t.common.more}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t.common.more}
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              onClick={() => choose(action.onSelect)}
            >
              {action.label}
            </button>
          ))}
          {actions.length > 0 && <div role="separator" className={styles.separator} />}
          <div role="group" aria-label={t.common.language}>
            {LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={language === option.value}
                tabIndex={-1}
                lang={option.value}
                className={styles.item}
                onClick={() => choose(() => setLanguage(option.value))}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function TopBar({ left, right, menu = [], onHome, homeDisabled }: TopBarProps) {
  const t = useT()
  const narrow = useMediaQuery(NARROW)
  const logo = (
    <>
      <img className={styles.mark} src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      <span className={styles.name}>{t.app.name}</span>
      <span className={styles.tagline}>{t.app.tagline}</span>
    </>
  )
  return (
    <header
      className={styles.bar}
      data-narrow={narrow || undefined}
      data-crowded={(narrow && Boolean(left)) || undefined}
    >
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
      {!narrow &&
        menu.map((action) => (
          <Button key={action.label} variant="ghost" onClick={action.onSelect}>
            {action.label}
          </Button>
        ))}
      {right}
      {narrow ? <MoreMenu actions={menu} /> : <LanguageSwitch />}
    </header>
  )
}
