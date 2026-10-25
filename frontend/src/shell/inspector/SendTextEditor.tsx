import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MutableRefObject } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { countKnownTokens, LexicalTokenEditor, type LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import { parseSendTextSegments, richFlavorSurvives } from '../../components/lexical/tokenNormalize';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { pickStatusNote } from '../../utils/sendTextStatus';
import type { SendMethod, SendMode } from '../../utils/sendTextTypes';
import { arrival } from '../list/selection';
import { useShell } from '../store';
import { DraftField, Section, Segmented } from './fields';
import { drafts, focusList, pendingEdits, type TextDraft } from './inspectorState';

/** Typing applies this long after the last key, like every field of the Inspector (rule 3). */
const IDLE_MS = 600;
/** The per-character pause under Type: 0 to 200 ms, 0 the default and kept out of the file. */
const MAX_CHAR_DELAY_MS = 200;
/** No answer from the engine in this long: it kept the step as it was, and the editor follows it. */
const ECHO_MS = 1500;

/** What a Send Text holds, the way the engine keeps it (actions:editSendText). */
interface Payload {
  text: string;
  html: string | null;
  markdown: string | null;
  mode: SendMode;
  method: SendMethod;
  delay: number;
}
const EMPTY: Payload = { text: '', html: null, markdown: null, mode: 'rich', method: 'paste', delay: 0 };

const stepPayload = (s: ActionItem): Payload => ({
  text: s.key, html: s.keyHtml ?? null, markdown: s.keyMarkdown ?? null,
  mode: s.sendMode ?? 'rich', method: s.sendMethod === 'type' ? 'type' : 'paste', delay: s.sendCharDelay ?? 0,
});
// The engine keeps each axis's default as null, and the pause only under Type: two payloads that
// read the same at the target compare the same.
const sigOf = (p: Payload) => JSON.stringify([
  p.text, p.html || null, p.markdown || null,
  p.mode === 'rich' ? null : p.mode,
  p.method === 'type' ? 'type' : null,
  p.method === 'type' && p.delay > 0 ? p.delay : null,
]);

const MODES: { value: SendMode; label: string; tip: string }[] = [
  { value: 'rich', label: 'Rich', tip: 'Real formatting (Gmail, Crisp, Word)' },
  { value: 'markdown', label: 'Markdown', tip: '*bold* / _italic_ as text — for WhatsApp' },
  { value: 'discord', label: 'Discord', tip: '**bold** / ~~strike~~ as text — for Discord' },
  { value: 'plain', label: 'Plain', tip: 'Only the text: the formatting stays with the step, unsent' },
];
const METHODS: { value: SendMethod; label: string; tip: string }[] = [
  { value: 'paste', label: 'Paste', tip: 'Ctrl+V — the only way that sends formatting' },
  { value: 'type', label: 'Type', tip: 'Key by key — for apps that ignore Ctrl+V' },
];

interface Editor {
  /** Sends what changed since the engine last had it. */
  commit: (over?: Partial<Payload>) => void;
  /** The document's export becomes what the engine is known to hold (once seeded). */
  baseline: () => void;
  /** The step moved to `sig`: an answer to a send, or something else to start again from. */
  follow: (sig: string) => void;
}

/**
 * ⑧ Send Text: the message in the rich editor (tokens as chips, `{` to search them, the formatting
 * bar), how the formatting travels (Message) and how the text gets there (Delivery), with the
 * counts and the one warning that applies under them (D9). It applies as you type (D12, rule 3):
 * the text goes to the engine when the typing stops, when the editor is left, on Ctrl+Enter — which
 * also gives the focus back to the list — and when it closes; each send is one Ctrl+Z.
 *
 * A Text being made (`draft`) has no step yet: its first text makes one at the insertion point, and
 * this same editor goes on with the step it became (drafts.adopt).
 *
 * Once seeded the editor is uncontrolled, so the step moving under it some other way (Ctrl+Z, Redo)
 * starts it again from the step; the step answering what was just sent does not.
 */
export default function SendTextEditor({ step, draft, locked }: { step: ActionItem | null; draft: TextDraft | null; locked: boolean }) {
  const cmds = useSteps();
  const tt = useTt();
  const apiRef = useRef<LexicalEditorHandle | null>(null);
  const [seed, setSeed] = useState(() => ({ nonce: 0, ...(step ? stepPayload(step) : EMPTY) }));
  const [text, setText] = useState(seed.text);
  const [hasFormatting, setHasFormatting] = useState(!!seed.html);
  const [mode, setMode] = useState(seed.mode);
  const [method, setMethod] = useState(seed.method);
  const [delay, setDelay] = useState(seed.delay);
  const stepId = step?.id ?? null;
  const pendingKey = `${stepId ?? 'new-text'}:text`;

  // What the engine holds as far as this editor knows (`last`, as the editor exports it; `sig`, as
  // the step reads), and `over`: the step as it read before a send, until the answer comes.
  const last = useRef<Payload | null>(null);
  const known = useRef<{ sig: string | null; over: string | null }>({ sig: step ? sigOf(stepPayload(step)) : null, over: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reseed = (s: ActionItem) => {
    const p = stepPayload(s);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pendingEdits.remove(pendingKey);
    last.current = null;
    known.current = { sig: sigOf(p), over: null };
    setSeed(prev => ({ nonce: prev.nonce + 1, ...p }));
    setText(p.text);
    setHasFormatting(!!p.html);
    setMode(p.mode);
    setMethod(p.method);
    setDelay(p.delay);
  };

  // The document as it stands, exported only now: getHtml walks the whole tree, so never per key.
  const exportNow = (over: Partial<Payload>): Payload | null => {
    const api = apiRef.current;
    if (!api) return null;
    const m = over.mode ?? mode;
    return {
      text: api.getText(),
      html: api.getHtml(),
      markdown: api.getMarkdown(m === 'discord' ? 'discord' : 'whatsapp'),
      mode: m,
      method: over.method ?? method,
      delay: over.delay ?? delay,
    };
  };

  const commit = (over: Partial<Payload> = {}) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const out = exportNow(over);
    // Not seeded yet: nothing typed to send.
    if (!out || !last.current) return;
    const sig = sigOf(out);
    if (sig === sigOf(last.current)) { pendingEdits.remove(pendingKey); return; }
    const charDelayMs = out.method === 'type' && out.delay > 0 ? out.delay : null;
    const body = { text: out.text, html: out.html ?? undefined, markdown: out.markdown ?? undefined, mode: out.mode, method: out.method, charDelayMs };
    if (step?.id) {
      pendingEdits.remove(pendingKey);
      const index = useShell.getState().app.actions.findIndex(a => a.id === step.id);
      if (index < 0) return;
      cmds.editSendText({ index, id: step.id, ...body });
      const now = sigOf(stepPayload(step));
      known.current = { sig, over: now === sig ? null : now };
      last.current = out;
      if (echo.current) clearTimeout(echo.current);
      echo.current = setTimeout(() => { echo.current = null; editor.current.follow(''); }, ECHO_MS);
      return;
    }
    // A Text being made, already sent: the step it becomes takes the rest once it arrives.
    if (!draft || draft.born) return;
    pendingEdits.remove(pendingKey);
    if (out.text.trim() === '') return;
    arrival.expect(draft.at, draft.macro, (arrived) => drafts.adopt(arrived.id));
    cmds.addSendText({ ...body, insertIndex: draft.at });
    drafts.born();
    known.current = { sig, over: null };
    last.current = out;
  };

  const follow = (sig: string) => {
    if (!step) return;
    const now = sigOf(stepPayload(step));
    const k = known.current;
    // '' is the answer that never came: the step still reads as before the send.
    if (sig === '') {
      if (k.over !== null && now === k.over) reseed(step);
      k.over = null;
      return;
    }
    if (sig === k.sig) { k.over = null; return; }
    if (k.over !== null && sig === k.over) return;
    reseed(step);
  };

  const editor = useRef<Editor>({ commit, baseline: () => {}, follow });
  useEffect(() => {
    editor.current = {
      commit,
      follow,
      baseline: () => {
        last.current = exportNow({}) ?? last.current;
        // A Text just asked for: the caret goes to it, ready for the first character.
        if (!step && draft && !draft.born) apiRef.current?.focus();
      },
    };
  });

  // The baseline, once per seeding: export against export, since the seeding round trip is not
  // byte-identical to what the step holds.
  useEffect(() => {
    const id = requestAnimationFrame(() => editor.current.baseline());
    return () => cancelAnimationFrame(id);
  }, [seed.nonce]);

  // The step moving under the editor.
  const sig = step ? sigOf(stepPayload(step)) : null;
  useEffect(() => {
    if (sig !== null) editor.current.follow(sig);
  }, [sig]);

  // A Text being made became a step while more was typed: that goes now.
  useEffect(() => {
    if (stepId) editor.current.commit();
  }, [stepId]);

  // The editor going (another step, the Inspector closing) sends what was typed, while the
  // document is still on the page.
  useLayoutEffect(() => () => close(editor, echo, pendingKey), [pendingKey]);

  const typed = () => {
    if (!last.current) return;   // the seeding itself, not typing
    pendingEdits.add(pendingKey);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => editor.current.commit(), IDLE_MS);
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    commit();
  };

  // The counts (D9): characters, the tokens the run fills in, and the lines the text makes at the
  // target — an Enter token makes one too.
  const tokens = countKnownTokens(text);
  let lines = 0;
  if (text.length > 0) {
    let enters = 0;
    for (const seg of parseSendTextSegments(text)) if (seg.kind === 'key' && seg.name === 'enter') enters += seg.count;
    lines = text.split('\n').length + enters;
  }
  const note = pickStatusNote({
    sendMode: mode, sendMethod: method, hasFormatting, tokenCount: tokens,
    richWillDegrade: hasFormatting && mode === 'rich' && !richFlavorSurvives(text),
  }, tt);

  return (
    <>
      <Section label="Message">
        <Segmented<SendMode>
          label="Message"
          value={mode}
          disabled={locked}
          options={MODES}
          onChange={(v) => { setMode(v); commit({ mode: v }); }}
        />
      </Section>
      <div className="insp-text" data-disabled={locked || undefined} inert={locked || undefined} onBlur={onBlur}>
        <LexicalTokenEditor
          key={seed.nonce}
          initialText={seed.text}
          initialHtml={seed.html}
          richMode
          // The formatting reaches the target unless the mode drops it (Plain) or the transport
          // cannot carry it (Type has no clipboard, so Rich arrives as plain text).
          formattingDelivered={mode !== 'plain' && !(method === 'type' && mode === 'rich')}
          onChange={(t) => { setText(t); typed(); }}
          onFormattingChange={(f) => { setHasFormatting(f); typed(); }}
          onSubmit={() => { commit(); focusList(); }}
          apiRef={apiRef}
          density="sheet"
          contentClassName="insp-text-content"
          placeholderClassName="insp-text-placeholder"
          tokenAutocomplete
          placeholder={<>Type the text to send…<span className="insp-text-placeholder-tip">Type {'{'} for tokens, like {'{enter}'} or {'{date}'}</span></>}
        />
      </div>
      <div className="insp-text-status">
        <span className="insp-text-counts">
          {text.length} chars · {tokens} token{tokens === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
        </span>
        {note && <span className="insp-text-note" data-tone={note.tone} data-tip={note.tip}>{note.text}</span>}
      </div>
      <Section
        label="Delivery"
        hint={method === 'type' ? 'Type sends key by key, for apps that block pasting.' : 'Paste goes through the clipboard and puts it back after.'}
      >
        <div className="insp-text-delivery">
          <Segmented<SendMethod>
            label="Delivery"
            value={method}
            disabled={locked}
            options={METHODS}
            onChange={(v) => { setMethod(v); commit({ method: v }); }}
          />
          {method === 'type' && (
            <DraftField
              stepId={stepId ?? 'new-text'}
              field="sendCharDelay"
              label="Per-character delay in milliseconds"
              kind="int"
              min={0}
              max={MAX_CHAR_DELAY_MS}
              empty="min"
              unit="ms"
              stored={String(delay)}
              disabled={locked}
              onApply={(v) => { const n = Number(v); setDelay(n); commit({ delay: n }); }}
            />
          )}
        </div>
      </Section>
    </>
  );
}

/** The editor closing: what was typed goes, and nothing waits for it any more. */
function close(editor: MutableRefObject<Editor>, echo: MutableRefObject<ReturnType<typeof setTimeout> | null>, pendingKey: string) {
  editor.current.commit();
  if (echo.current) clearTimeout(echo.current);
  pendingEdits.remove(pendingKey);
}
