import { ImportPreviewDialog } from '../../components/ImportPreviewDialog';
import { ImportResultDialog } from '../../components/ImportResultDialog';
import { SecurityWarningModal } from '../../components/SecurityWarningModal';
import type { useImport } from '../../logic/useImport';

/**
 * ③ ⋯ › Import macros…, after the file is chosen: the security warning (until the user turns it
 * off), the preview where macros are picked and name clashes settled, and the result when there is
 * something to read. The dialogs are the ones the shell of today uses, loaded when an import
 * first needs them (rule 6).
 */
export default function ImportFlow({ flow }: { flow: ReturnType<typeof useImport> }) {
  return (
    <>
      {flow.warning && (
        <SecurityWarningModal
          fileName={flow.warning.fileName}
          profileCount={flow.warning.profiles.length}
          onContinue={flow.passWarning}
          onCancel={flow.cancel}
        />
      )}
      {flow.preview && !flow.warning && (
        <ImportPreviewDialog preview={flow.preview} onConfirm={flow.confirm} onCancel={flow.cancel} />
      )}
      {flow.result && <ImportResultDialog result={flow.result} onClose={flow.closeResult} />}
    </>
  );
}
