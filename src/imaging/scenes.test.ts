import { describe, expect, it } from 'vitest'
import { renderScene, type SceneId } from './scenes.ts'

const IDS: SceneId[] = ['sunset', 'meadow', 'night', 'snow', 'autumn']

describe('renderScene', () => {
  it.each(IDS)('%s is deterministic, sized and opaque', (id) => {
    const a = renderScene(id, 32, 24)
    const b = renderScene(id, 32, 24)
    expect([a.width, a.height]).toEqual([32, 24])
    expect(a.data).toEqual(b.data)
    for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255)
  })
  it('scenes differ from each other', () => {
    expect(renderScene('sunset', 16, 16).data).not.toEqual(renderScene('meadow', 16, 16).data)
  })
})
