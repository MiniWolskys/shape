import { useSyncExternalStore } from 'react'

/** Phone-width windows: the top bar folds its secondary actions, the step rail a selector. */
export const NARROW = '(max-width: 759px)'
/** Touch screens or phone widths: the editor says it works best on a computer (I24). */
export const PHONE = `(pointer: coarse), ${NARROW}`

function mediaQuery(query: string): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}

/** Whether the CSS media query matches now, following changes (false without matchMedia). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaQuery(query)
      list?.addEventListener?.('change', onChange)
      return () => list?.removeEventListener?.('change', onChange)
    },
    () => mediaQuery(query)?.matches ?? false,
  )
}
