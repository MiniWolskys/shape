import { describe, expect, it } from 'vitest'
import { outlinePath, toDistance } from './pixelTools.ts'

describe('outlinePath', () => {
  it('traces the border of a selected block', () => {
    // 3×3 with the centre pixel selected.
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0])
    expect(outlinePath(mask, 3, 3)).toBe('M1 1H2M1 2H2M1 1V2M2 1V2')
  })

  it('merges runs along a row and follows the painting edge', () => {
    const mask = new Uint8Array([1, 1, 0, 0])
    expect(outlinePath(mask, 2, 2)).toBe('M0 0H2M0 1H2M0 0V1M2 0V1')
  })

  it('is empty for an empty selection', () => {
    expect(outlinePath(new Uint8Array(4), 2, 2)).toBe('')
  })
})

describe('toDistance', () => {
  it('maps tolerance percent to a channel distance', () => {
    expect(toDistance(0)).toBe(0)
    expect(toDistance(100)).toBe(255)
    expect(toDistance(12)).toBe(31)
  })
})
