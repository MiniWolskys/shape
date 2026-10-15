import { useEffect, useState } from 'react'
import type { Dictionary } from './en.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/** Average lengths: "2 months ago" needs no calendar. */
const MONTH = 30.44 * DAY
const YEAR = 365.25 * DAY

/** "5 minutes ago", "yesterday", "2 weeks ago"… or "just now" in the dictionary's language. */
export function timeAgo(iso: string, now: number, t: Dictionary): string {
  const elapsed = now - Date.parse(iso)
  if (!(elapsed >= MINUTE)) return t.common.justNow
  const words = new Intl.RelativeTimeFormat(t.locale, { numeric: 'auto' })
  if (elapsed < HOUR) return words.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return words.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < WEEK) return words.format(-Math.floor(elapsed / DAY), 'day')
  if (elapsed < MONTH) return words.format(-Math.floor(elapsed / WEEK), 'week')
  if (elapsed < YEAR) return words.format(-Math.floor(elapsed / MONTH), 'month')
  return words.format(-Math.floor(elapsed / YEAR), 'year')
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
