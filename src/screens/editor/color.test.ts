import { describe, expect, it } from 'vitest'
import { DYE_IDS } from '../../domain/types.ts'
import {
  alphaToPercent,
  dyeColor,
  frameColor,
  hsvToRgb,
  parseHex,
  percentToAlpha,
  rgbToHsv,
  toHex,
} from './color.ts'

describe('colour helpers', () => {
  it('parses #RRGGBB and #RGB, nothing else', () => {
    expect(parseHex('#12ab34')).toEqual([0x12, 0xab, 0x34])
    expect(parseHex('#F0a')).toEqual([0xff, 0x00, 0xaa])
    for (const bad of ['#12', '12ab34', '#12ab3', '#12ab345', '#ggg', '']) {
      expect(parseHex(bad)).toBeNull()
    }
  })

  it('formats hex in upper case', () => {
    expect(toHex([18, 171, 52, 10])).toBe('#12AB34')
  })

  it('round-trips RGB through HSV', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [242, 166, 90],
      [18, 171, 52],
      [60, 68, 170],
    ] as const) {
      expect(hsvToRgb(rgbToHsv(rgb))).toEqual(rgb)
    }
  })

  it('converts opacity percent and alpha', () => {
    expect(percentToAlpha(50)).toBe(128)
    expect(percentToAlpha(140)).toBe(255)
    expect(alphaToPercent(64)).toBe(25)
  })

  it('has 16 opaque dye colours and an opaque frame colour (dark oak for none)', () => {
    expect(DYE_IDS).toHaveLength(16)
    expect(dyeColor('yellow')).toEqual([0xfe, 0xd8, 0x3d, 255])
    expect(frameColor('none')).toEqual([74, 47, 28, 255])
  })
})
