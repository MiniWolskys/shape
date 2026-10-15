import { describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { fr } from './fr.ts'
import { timeAgo } from './timeAgo.ts'

const now = Date.parse('2026-10-15T12:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

describe('timeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(timeAgo(ago(20_000), now, en)).toBe('just now')
    expect(timeAgo(ago(20_000), now, fr)).toBe('à l’instant')
  })

  it('counts minutes, hours and days', () => {
    expect(timeAgo(ago(5 * MINUTE), now, en)).toBe('5 minutes ago')
    expect(timeAgo(ago(3 * 60 * MINUTE), now, en)).toBe('3 hours ago')
    expect(timeAgo(ago(DAY), now, en)).toBe('yesterday')
    expect(timeAgo(ago(3 * DAY), now, fr)).toBe('il y a 3 jours')
  })

  it('counts weeks, months and years', () => {
    expect(timeAgo(ago(10 * DAY), now, en)).toBe('last week')
    expect(timeAgo(ago(15 * DAY), now, en)).toBe('2 weeks ago')
    expect(timeAgo(ago(70 * DAY), now, en)).toBe('2 months ago')
    expect(timeAgo(ago(800 * DAY), now, en)).toBe('2 years ago')
    expect(timeAgo(ago(800 * DAY), now, fr)).toBe('il y a 2 ans')
  })
})
