import { describe, expect, it } from 'vitest'
import { anchorPoint, anchoredScroll, nextZoom } from './stageZoom.ts'

describe('nextZoom', () => {
  it('steps through the zoom levels and stays at the ends', () => {
    expect(nextZoom(1, 1)).toBe(2)
    expect(nextZoom(1.7, 1)).toBe(2)
    expect(nextZoom(1.7, -1)).toBe(1)
    expect(nextZoom(64, 1)).toBe(64)
    expect(nextZoom(0.25, -1)).toBe(0.25)
  })
})

describe('zoom anchored at a point', () => {
  it('finds the painting point under the anchor', () => {
    // The painting starts 100 px into the view at 4 px per pixel: 140 px is pixel 10.
    expect(anchorPoint({ paintingStart: 100, scale: 4, anchor: 140 })).toBe(10)
  })

  it('scrolls so the same painting point stays under the anchor', () => {
    const point = anchorPoint({ paintingStart: 100, scale: 4, anchor: 140 })
    // After zooming to 8, the painting starts at 30 (centring changed); scroll is 0.
    const scroll = anchoredScroll({ scroll: 0, paintingStart: 30, scale: 8, point, anchor: 140 })
    // Scrolling by s moves the painting to 30 - s: 30 - s + 10 * 8 = 140 → s = -30.
    expect(scroll).toBe(-30)
    expect(30 - scroll + point * 8).toBe(140)
  })

  it('keeps the point under the cursor when zooming in on a scrolled painting', () => {
    // At scale 2 the painting is scrolled by 500: it starts at -484 on screen.
    const point = anchorPoint({ paintingStart: -484, scale: 2, anchor: 316 })
    expect(point).toBe(400)
    // At scale 4 without any new scroll it would start at -484 + 0 (same scroll, same margin).
    const scroll = anchoredScroll({
      scroll: 500,
      paintingStart: -484,
      scale: 4,
      point,
      anchor: 316,
    })
    // The painting then starts at -484 - (scroll - 500) and pixel 400 sits at 316.
    expect(-484 - (scroll - 500) + 400 * 4).toBe(316)
  })
})
