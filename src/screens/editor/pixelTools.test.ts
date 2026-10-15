import { describe, expect, it } from 'vitest'
import { toDistance } from './pixelTools.ts'

describe('toDistance', () => {
  it('maps tolerance percent to a channel distance', () => {
    expect(toDistance(0)).toBe(0)
    expect(toDistance(100)).toBe(255)
    expect(toDistance(12)).toBe(31)
  })
})
