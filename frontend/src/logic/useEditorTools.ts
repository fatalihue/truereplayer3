import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { OutgoingMessage } from '../bridge/messageTypes';

type ToolType = Extract<OutgoingMessage['type'],
  | 'mouse:pickPosition' | 'pixel:pickColor' | 'waitimage:configureSearchRegion' | 'waitimage:recapture'
  | 'waitimage:cropReference' | 'pixel:testMatch' | 'image:testMatch' | 'ocr:testRead'
  | 'profile:detectWindow' | 'window:testProbe' | 'window:captureGeometry' | 'process:list' | 'dialog:pickFile'
  | 'dialog:saveFile' | 'browser:pickElement' | 'browser:cancelPick' | 'browser:testAction' | 'browser:testCondition'>;
type MessageOf<T extends ToolType> = Extract<OutgoingMessage, { type: T }>;

/** The id a tool's reply carries back: eight base-36 characters, enough for the replies one editor waits on. */
export const newRequestId = () => Math.random().toString(36).slice(2, 10);

/**
 * The editors' tools that reach outside the app, as commands: picking on the screen, testing a
 * reference image, a pixel or a screen read against the live screen, finding a window or a process,
 * the file dialogs, and the browser extension's element pick and tests. Each takes its message's own
 * payload. Most carry a requestId and get it back on the reply; the editor that asked keeps the id
 * and drops a reply that carries any other.
 */
export function useEditorTools() {
  const { send } = useBridge();
  return useMemo(() => {
    const cmd = <T extends ToolType>(type: T) =>
      (payload: MessageOf<T>['payload']) => send({ type, payload } as MessageOf<T>);
    return {
      // ── on the screen ──
      pickPosition: cmd('mouse:pickPosition'),
      pickColor: cmd('pixel:pickColor'),
      configureSearchRegion: cmd('waitimage:configureSearchRegion'),
      recaptureImage: cmd('waitimage:recapture'),
      cropImage: cmd('waitimage:cropReference'),
      testPixel: cmd('pixel:testMatch'),
      testImage: cmd('image:testMatch'),
      testScreenText: cmd('ocr:testRead'),
      // ── windows, processes and files ──
      /** `enabled` true arms a click-to-detect on the next window clicked; false cancels it. */
      detectWindow: cmd('profile:detectWindow'),
      testWindow: cmd('window:testProbe'),
      captureWindowGeometry: cmd('window:captureGeometry'),
      listProcesses: cmd('process:list'),
      pickFile: cmd('dialog:pickFile'),
      /** The system's Save dialog for a file built here; dialog:saveFileResult says where it went. */
      saveFile: cmd('dialog:saveFile'),
      // ── the browser extension ──
      pickElement: cmd('browser:pickElement'),
      cancelPick: cmd('browser:cancelPick'),
      testBrowserAction: cmd('browser:testAction'),
      testBrowserCondition: cmd('browser:testCondition'),
    };
  }, [send]);
}
