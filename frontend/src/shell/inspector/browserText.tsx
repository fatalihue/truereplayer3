import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MutableRefObject } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { LexicalTokenEditor, type LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import { useSteps } from '../../logic/useSteps';
import { applyEdits, focusList, pendingEdits } from './inspectorState';

// The typing has stopped: what was typed goes to the engine.
const IDLE_MS = 600;
// The three tokens a Type Text uses most, put at the caret (editor-passo-141); any other is typed.
const CHIPS = [
  { token: '{Clipboard}', label: 'Clipboard' },
  { token: '{Enter}', label: 'Enter' },
  { token: '{DateTime}', label: 'DateTime' },
];

interface Field {
  /** Sends the text if it changed since the engine last had it. */
  commit: () => void;
  /** The text as the editor exports it becomes what the engine is known to hold (once seeded). */
  baseline: () => void;
  /** The step's text moved: an answer to a send, or something else to start again from. */
  follow: (stored: string) => void;
}

/**
 * Type Text's text (editor-passo-140 and 141): the Send Text's token editor, with the tokens as
 * chips (`{` searches them) under the extension's key grammar, and three tokens to put at the caret.
 * It applies like any field — when the typing stops, when it is left, and on Ctrl+Enter, which also
 * gives the focus back to the list —; the step's text moving some other way (Ctrl+Z) starts it
 * again from the step.
 */
export default function TypeTextField({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const apiRef = useRef<LexicalEditorHandle | null>(null);
  const id = step.id ?? '';
  const stored = step.browserText ?? '';
  const pendingKey = `${id}:browserText`;
  const [seed, setSeed] = useState({ nonce: 0, text: stored });
  // What the engine holds as far as this field knows: null until the seeding is exported.
  const held = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pendingEdits.remove(pendingKey);
    const api = apiRef.current;
    if (!api || held.current === null) return;
    const text = api.getText();
    if (text === held.current) return;
    held.current = text;
    applyEdits(cmds, id, [{ field: 'browserText', value: text }]);
  };

  const field = useRef<Field>({ commit, baseline: () => {}, follow: () => {} });
  useEffect(() => {
    field.current = {
      commit,
      baseline: () => { held.current = apiRef.current?.getText() ?? seed.text; },
      follow: (now: string) => {
        if (held.current === null || now === held.current) return;
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        pendingEdits.remove(pendingKey);
        held.current = null;
        setSeed(s => ({ nonce: s.nonce + 1, text: now }));
      },
    };
  });

  // The baseline, once per seeding: export against export.
  useEffect(() => {
    const frame = requestAnimationFrame(() => field.current.baseline());
    return () => cancelAnimationFrame(frame);
  }, [seed.nonce]);
  // The step's text moving under the field.
  useEffect(() => { field.current.follow(stored); }, [stored]);
  // The field going (another step, the Inspector closing) sends what was typed.
  useLayoutEffect(() => () => close(field), []);

  const typed = () => {
    if (held.current === null) return;   // the seeding itself, not typing
    pendingEdits.add(pendingKey);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => field.current.commit(), IDLE_MS);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    commit();
  };

  return (
    <>
      <div className="insp-text" data-disabled={locked || undefined} inert={locked || undefined} onBlur={onBlur}>
        <LexicalTokenEditor
          key={seed.nonce}
          initialText={seed.text}
          onChange={typed}
          onSubmit={() => { commit(); focusList(); }}
          apiRef={apiRef}
          density="sheet"
          contentClassName="insp-text-content"
          placeholderClassName="insp-text-placeholder"
          tokenAutocomplete
          tokenScope="browser"
          ariaLabel="Text to type"
          placeholder={<>Text to type…<span className="insp-text-placeholder-tip">Type {'{'} for tokens, like {'{enter}'}</span></>}
        />
      </div>
      <div className="insp-chips">
        {CHIPS.map(c => (
          <button key={c.token} type="button" disabled={locked} onClick={() => { apiRef.current?.insertText(c.token); typed(); }}>
            {c.label}
          </button>
        ))}
      </div>
    </>
  );
}

function close(field: MutableRefObject<Field>) {
  field.current.commit();
}
