import { useT } from '../i18n/i18n.ts'
import styles from './Toasts.module.css'
import { useToasts } from './toastStore.ts'

export function Toasts() {
  const t = useT()
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div role="status" aria-live="polite" className={styles.region}>
      {toasts.map((item) => (
        <div
          key={item.id}
          className={[styles.toast, item.kind === 'error' && styles.error]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.message}>{item.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            aria-label={t.common.close}
            onClick={() => dismiss(item.id)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
