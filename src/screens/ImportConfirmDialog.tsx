import { plural, useT } from '../i18n/i18n.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { CloseLibraryDialog } from './CloseLibraryDialog.tsx'
import { answerImport, useImportConfirm } from './importConfirm.ts'

/** The questions an import asks (see askImport); mounted once, next to the app's file drop. */
export function ImportConfirmDialog() {
  const t = useT()
  const question = useImportConfirm((s) => s.question)

  if (question?.kind === 'replaceDemo') {
    return (
      <CloseLibraryDialog
        open
        onCancel={() => answerImport(false)}
        onConfirm={() => answerImport(true)}
      />
    )
  }

  const values: Record<string, string> =
    question?.kind === 'copy' ? { source: question.source, library: question.library } : {}
  const count = question?.kind === 'copy' ? question.count : 0
  return (
    <Dialog
      open={question?.kind === 'copy'}
      title={plural(t, t.packImport.confirmTitle, count, values)}
      onClose={() => answerImport(false)}
      actions={
        <>
          <Button variant="ghost" onClick={() => answerImport(false)}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={() => answerImport(true)}>
            {plural(t, t.packImport.confirmAdd, count)}
          </Button>
        </>
      }
    >
      <p>{plural(t, t.packImport.confirmBody, count, values)}</p>
    </Dialog>
  )
}
