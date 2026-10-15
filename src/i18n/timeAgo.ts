import { useEffect, useState } from 'react'
import type { Dictionary } from './en.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "5 minutes ago", "yesterday", or "just now" in the dictionary's language. */
export function timeAgo(iso: string, now: number, t: Dictionary): string {
  const elapsed = now - Date.parse(iso)
  if (!(elapsed >= MINUTE)) return t.common.justNow
  const words = new Intl.RelativeTimeFormat(t.locale, { numeric: 'auto' })
  if (elapsed < HOUR) return words.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return words.format(-Math.floor(elapsed / HOUR), 'hour')
  return words.format(-Math.floor(elapsed / DAY), 'day')
}

/** The current time, updated every minute, for "saved 5 minutes ago". */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}
