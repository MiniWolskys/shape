import { createRaster, type Raster, type RGB } from './raster.ts'
import { mulberry32 } from './shapes.ts'

export type SceneId = 'sunset' | 'meadow' | 'night' | 'snow' | 'autumn'

interface Scene {
  top: RGB
  bot: RGB
  sun: RGB
  hills: readonly [RGB, RGB, RGB]
  stars?: boolean
}

const SCENES: Record<SceneId, Scene> = {
  sunset: {
    top: [70, 40, 96],
    bot: [250, 162, 80],
    sun: [255, 222, 130],
    hills: [
      [150, 76, 78],
      [92, 48, 66],
      [46, 28, 44],
    ],
  },
  meadow: {
    top: [80, 140, 228],
    bot: [196, 226, 252],
    sun: [255, 250, 214],
    hills: [
      [120, 180, 86],
      [76, 138, 62],
      [40, 96, 52],
    ],
  },
  night: {
    top: [10, 14, 38],
    bot: [44, 58, 112],
    sun: [232, 232, 210],
    hills: [
      [44, 56, 92],
      [30, 36, 66],
      [16, 20, 42],
    ],
    stars: true,
  },
  snow: {
    top: [140, 172, 214],
    bot: [226, 234, 244],
    sun: [255, 255, 250],
    hills: [
      [238, 242, 250],
      [200, 212, 230],
      [118, 138, 170],
    ],
  },
  autumn: {
    top: [236, 146, 86],
    bot: [252, 214, 156],
    sun: [255, 244, 200],
    hills: [
      [214, 120, 52],
      [170, 70, 40],
      [96, 46, 34],
    ],
  },
}

const SCENE_SEEDS: Record<SceneId, number> = { sunset: 1, meadow: 2, night: 3, snow: 4, autumn: 5 }
const STAR_COLOR: RGB = [240, 240, 255]
const BANDS = 12

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function scenePixel(
  sc: Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  stars: Set<number>,
): RGB {
  const t = Math.floor((y / h) * BANDS) / BANDS
  let c = mix(sc.top, sc.bot, t)
  const sx = w * 0.68
  const sy = h * 0.46
  const sr = Math.min(w, h) * 0.12
  if (Math.hypot(x - sx, y - sy) < sr) c = sc.sun
  else if (sc.stars && stars.has(y * w + x)) c = STAR_COLOR
  for (let i = 0; i < 3; i++) {
    const u = x / w
    const base = 0.56 + 0.13 * i
    const hh =
      base + 0.06 * (Math.sin(u * (5 + i * 3) + i * 2.1) * 0.6 + Math.sin(u * (11 + i) + i) * 0.4)
    if (y / h > hh) {
      c = sc.hills[i] ?? c
      if (i === 2 && (x * 7 + y * 3) % 11 === 0) c = mix(c, [0, 0, 0], 0.2)
    }
  }
  return c
}

/** A deterministic, fully opaque pixel landscape. */
export function renderScene(id: SceneId, width: number, height: number): Raster {
  const sc = SCENES[id]
  const out = createRaster(width, height)
  const stars = new Set<number>()
  if (sc.stars) {
    const rand = mulberry32(width * 31 + height * 7 + SCENE_SEEDS[id])
    const count = Math.floor((width * height) / 60)
    for (let i = 0; i < count; i++) stars.add(Math.floor(rand() * width * height * 0.5))
  }
  const d = out.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = scenePixel(sc, x, y, width, height, stars)
      const i = (y * width + x) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
  return out
}
