/** Zoom levels of the canvas, in CSS pixels per painting pixel. */
export const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]

/** The next zoom level up (1) or down (-1) from `scale`, staying at the ends. */
export function nextZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > scale + 1e-6) ?? scale
  return [...ZOOM_STEPS].reverse().find((z) => z < scale - 1e-6) ?? scale
}

/**
 * The painting coordinate (in painting pixels, along one axis) under `anchor`, where the
 * painting's edge is drawn at `paintingStart` (both in the same screen coordinates).
 */
export function anchorPoint(o: { paintingStart: number; scale: number; anchor: number }): number {
  return (o.anchor - o.paintingStart) / o.scale
}

/**
 * The scroll offset (along one axis) that brings painting coordinate `point` back under
 * `anchor` after a zoom: `paintingStart` is where the painting's edge is drawn now, at the new
 * `scale`, with the view scrolled by `scroll`. Scrolling by d moves the painting by −d.
 */
export function anchoredScroll(o: {
  scroll: number
  paintingStart: number
  scale: number
  point: number
  anchor: number
}): number {
  return o.scroll + o.paintingStart + o.point * o.scale - o.anchor
}
