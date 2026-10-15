import { useLanguage, useT, type Language } from '../i18n/i18n.ts'
import styles from './LanguageSwitch.module.css'

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'EN' },
  { value: 'fr', label: 'FR' },
]

/** Compact EN · FR toggle. */
export function LanguageSwitch() {
  const t = useT()
  const language = useLanguage((s) => s.language)
  const setLanguage = useLanguage((s) => s.setLanguage)
  return (
    <div role="group" aria-label={t.common.language} className={styles.switch}>
      {LANGUAGES.map((option, index) => (
        <span key={option.value}>
          {index > 0 && <span aria-hidden="true">· </span>}
          <button
            type="button"
            lang={option.value}
            aria-pressed={language === option.value}
            className={styles.option}
            onClick={() => setLanguage(option.value)}
          >
            {option.label}
          </button>
        </span>
      ))}
    </div>
  )
}
