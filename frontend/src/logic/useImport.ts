import { useCallback, useEffect, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { ImportConflictResolution, ImportPreviewPayload, ImportResultPayload } from '../bridge/messageTypes';
import { useMacro } from './useMacro';

/**
 * Bringing macros in from a .trprofile file. `start` opens the file picker; the engine reads the
 * file and answers with a preview. When the user has not turned the security warning off, the
 * preview waits behind it (`warning`); otherwise it is `preview` at once. Confirming imports the
 * chosen macros, and an import with something to read (renamed, skipped, images or targets not
 * kept) comes back as `result`. Cancelling at either step drops the file the engine is holding.
 */
export function useImport() {
  const { subscribe } = useBridge();
  const macro = useMacro();
  const [warning, setWarning] = useState<ImportPreviewPayload | null>(null);
  const [preview, setPreview] = useState<ImportPreviewPayload | null>(null);
  const [result, setResult] = useState<ImportResultPayload | null>(null);

  useEffect(() => subscribe((msg) => {
    if (msg.type === 'profile:importPreview') {
      if (msg.payload.requiresAcknowledgement) setWarning(msg.payload);
      else setPreview(msg.payload);
    } else if (msg.type === 'profile:importResult') {
      setResult(msg.payload);
    }
  }), [subscribe]);

  const passWarning = useCallback((dontShowAgain: boolean) => {
    if (dontShowAgain) macro.acknowledgeImportWarning();
    setPreview(warning);
    setWarning(null);
  }, [macro, warning]);

  const cancel = useCallback(() => {
    setWarning(null);
    setPreview(null);
    macro.cancelImport();
  }, [macro]);

  const confirm = useCallback((names: string[], resolutions: Record<string, ImportConflictResolution>) => {
    // Confirming with nothing chosen is a cancel: the engine still drops the file it read.
    if (names.length > 0) macro.confirmImport(names, resolutions);
    else macro.cancelImport();
    setPreview(null);
  }, [macro]);

  const closeResult = useCallback(() => setResult(null), []);

  return { start: macro.startImport, warning, preview, result, passWarning, cancel, confirm, closeResult };
}
