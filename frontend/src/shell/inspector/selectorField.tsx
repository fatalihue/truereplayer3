import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionItem, SelectorAlternative } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { DraftField, Section } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { useAsk } from './probes';

// The selector's stability, from its text alone (no page): an id or a test hook is stable, a name or
// a label strong, a text match or a tag with a class decent, a path through the tree fragile.
export function estimateTier(selector: string): SelectorAlternative['tier'] {
  const s = selector.trim();
  if (!s) return 'C';
  if (s.startsWith('text=') || s.startsWith('text*=') || s.startsWith('text~=') || s.startsWith('text/')) return 'B';
  if (/^#[A-Za-z_][\w-]*$/.test(s)) return 'S';
  if (/\[data-(testid|test|cy|qa)=/.test(s)) return 'S';
  if (/\[(name|aria-label|placeholder)=/.test(s)) return 'A';
  if (s.includes(':nth-') || s.includes(' > ')) return 'C';
  if (/^[a-z]+\./i.test(s)) return 'B';
  return 'C';
}
const TIER_NAMES: Record<SelectorAlternative['tier'], string> = { S: 'Stable', A: 'Strong', B: 'Decent', C: 'Fragile' };
const TIER_NAMES_PT: Record<SelectorAlternative['tier'], string> = { S: 'Estável', A: 'Forte', B: 'Razoável', C: 'Frágil' };

/** The shield: how stable a selector reads, S to C (editor-passo-128). */
export function Tier({ selector, tier = estimateTier(selector) }: { selector: string; tier?: SelectorAlternative['tier'] }) {
  const tt = useTt();
  return <span className="insp-tier" data-tier={tier} data-tip={tt(`${tier} · ${TIER_NAMES[tier]}`, `${tier} · ${TIER_NAMES_PT[tier]}`)}>{tier} · {TIER_NAMES[tier]}</span>;
}

/**
 * An element of the page by its CSS selector — the If's Browser element and the browser steps: the
 * shield, and Pick element, which takes it from the page through the extension (Esc cancels). With
 * two or more candidates the alternatives show, and stay saved as the run's fallbacks; typing the
 * selector drops them. `stored` is what the field shows: nothing when the step finds its element by
 * its text instead (Text Match).
 */
export function SelectorField({ step, locked, hint, stored = step.key ?? '' }: { step: ActionItem; locked: boolean; hint?: ReactNode; stored?: string }) {
  const cmds = useSteps();
  const tools = useEditorTools();
  const tt = useTt();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const alternatives = step.selectorAlternatives ?? [];
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const pick = useAsk('browser:pickResult', (r) => {
    if (!r.selector) { setPickError(r.error || null); return; }
    setPickError(null);
    const alts = r.alternatives ?? [];
    edit([{ field: 'key', value: r.selector }, { field: 'selectorAlternatives', value: alts.length > 1 ? JSON.stringify(alts) : '' }]);
    setShowAlternatives(alts.length > 1);
  });
  // Leaving the step cancels a pick still waiting on the page (editor-passo-005), and Esc cancels it
  // before the Inspector takes the key.
  const live = useRef(pick.waiting);
  useEffect(() => { live.current = pick.waiting; });
  useEffect(() => () => cancelPick(tools, live), [tools]);
  useEffect(() => {
    if (!pick.waiting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      tools.cancelPick({});
      pick.drop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <Section
      label="CSS selector"
      aside={stored ? <Tier selector={stored} /> : undefined}
      hint={pickError ? <span data-error="">{pickError}</span> : hint}
    >
      <div className="insp-line">
        <DraftField
          stepId={id}
          field="key"
          label="CSS selector"
          kind="mono"
          placeholder=".btn-save"
          stored={stored}
          disabled={locked}
          parse={(t) => t.trim()}
          onApply={(v) => { setShowAlternatives(false); edit([{ field: 'key', value: v }, { field: 'selectorAlternatives', value: '' }]); }}
        />
        <button
          type="button"
          className="insp-icon-button"
          aria-label="Pick element"
          aria-pressed={pick.waiting}
          data-tip={pick.waiting ? tt('Picking on the page · Esc cancels', 'Escolhendo na página · Esc cancela') : tt('Pick an element on the page', 'Escolher um elemento na página')}
          disabled={locked}
          onClick={() => {
            if (pick.waiting) { tools.cancelPick({}); pick.drop(); return; }
            setShowAlternatives(false);
            setPickError(null);
            pick.ask(requestId => tools.pickElement({ requestId }));
          }}
        >
          <span className="step-icon" data-icon="crosshair" />
        </button>
      </div>
      {showAlternatives && alternatives.length > 1 && (
        <div className="insp-alts" role="group" aria-label="Alternatives">
          <span className="insp-alts-head">
            Alternatives
            <button type="button" className="insp-icon-button" aria-label="Close alternatives" onClick={() => setShowAlternatives(false)}>
              <span className="step-icon" data-icon="x" />
            </button>
          </span>
          {alternatives.map((alt, i) => (
            <button
              key={i}
              type="button"
              data-tip={alt.description}
              disabled={locked}
              onClick={() => { edit([{ field: 'key', value: alt.selector }]); setShowAlternatives(false); }}
            >
              <span className="insp-tier" data-tier={alt.tier}>{alt.tier}</span>
              <span className="insp-mono">{alt.selector}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function cancelPick(tools: ReturnType<typeof useEditorTools>, live: { current: boolean }) {
  if (live.current) tools.cancelPick({});
}
