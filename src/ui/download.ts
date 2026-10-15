/** Saves bytes as a file through a temporary link to an object URL. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke on the next task so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
