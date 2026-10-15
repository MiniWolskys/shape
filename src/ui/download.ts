const REVOKE_AFTER_MS = 10_000

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
  // Some browsers read the URL lazily; give the download time to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
}
