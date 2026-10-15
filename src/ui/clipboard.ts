/** Copies through a hidden, selected textarea, for browsers without the async clipboard API. */
function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    return document.execCommand('copy')
  } finally {
    area.remove()
  }
}

/** Selects the text of `element` so the player can copy it by hand. */
export function selectText(element: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Copies `text` to the clipboard: the async clipboard API first, then a selection copy.
 * Resolves to false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (error) {
      console.warn('The clipboard API refused the copy; trying a selection copy', error)
    }
  }
  try {
    return copyWithSelection(text)
  } catch (error) {
    console.warn('The selection copy failed', error)
    return false
  }
}
