import { create } from 'zustand'

/**
 * A question an import asks before it changes the library (R21, R25): adding another
 * library's paintings as copies, or replacing a demo the player changed.
 */
export type ImportQuestion =
  { kind: 'copy'; count: number; source: string; library: string } | { kind: 'replaceDemo' }

interface ImportConfirmState {
  question: ImportQuestion | null
  answer: ((ok: boolean) => void) | null
}

export const useImportConfirm = create<ImportConfirmState>(() => ({
  question: null,
  answer: null,
}))

/** Shows the question (ImportConfirmDialog) and resolves with the player's answer. */
export function askImport(question: ImportQuestion): Promise<boolean> {
  // A question still open is answered "no": only the latest import goes ahead.
  useImportConfirm.getState().answer?.(false)
  return new Promise((resolve) => {
    useImportConfirm.setState({ question, answer: resolve })
  })
}

/** Closes the question with the player's answer. */
export function answerImport(ok: boolean): void {
  const { answer } = useImportConfirm.getState()
  useImportConfirm.setState({ question: null, answer: null })
  answer?.(ok)
}
