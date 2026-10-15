/**
 * SVG path data tracing the edges between selected and unselected pixels, in painting pixels:
 * horizontal runs for each row boundary, then vertical runs for each column boundary.
 */
export function outlinePath(mask: Uint8Array, width: number, height: number): string {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? (mask[y * width + x] ?? 0) : 0
  const parts: string[] = []
  for (let y = 0; y <= height; y++) {
    let x = 0
    while (x < width) {
      if (at(x, y - 1) === at(x, y)) {
        x++
        continue
      }
      const start = x
      while (x < width && at(x, y - 1) !== at(x, y)) x++
      parts.push(`M${start} ${y}H${x}`)
    }
  }
  for (let x = 0; x <= width; x++) {
    let y = 0
    while (y < height) {
      if (at(x - 1, y) === at(x, y)) {
        y++
        continue
      }
      const start = y
      while (y < height && at(x - 1, y) !== at(x, y)) y++
      parts.push(`M${x} ${start}V${y}`)
    }
  }
  return parts.join('')
}
