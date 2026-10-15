import { describe, expect, it } from 'vitest'
import { createScrollMemory } from './scrollMemory.ts'

describe('scroll memory', () => {
  it('returns to where a screen was left when the player goes Back to it', () => {
    const memory = createScrollMemory()
    memory.save('library', 640)
    memory.save('editor:rose', 0)
    expect(memory.target('library', true)).toBe(640)
  })

  it('opens a screen at its top when it is reached by a link or a button', () => {
    const memory = createScrollMemory()
    memory.save('library', 640)
    expect(memory.target('library', false)).toBe(0)
  })

  it('opens a screen never seen at its top, even through history', () => {
    expect(createScrollMemory().target('export', true)).toBe(0)
  })
})
