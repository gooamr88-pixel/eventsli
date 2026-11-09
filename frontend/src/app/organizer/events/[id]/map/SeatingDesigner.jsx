'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { useModal } from '../../../../hooks/useModal';
import { useAiQuota } from '../../../../hooks/useAiQuota';
import FormError from '../../../../components/forms/FormError';
import NavIcon from '../../../../components/shell/NavIcon';
import { QuotaDots } from '../../new/ai/AiParts';
import { SHAPE_NAMES } from './shapeNames';
import { zoneMeta } from '../../../../components/seating/venueZones';
import { layoutPlan } from './seatingLayout';
import { keepKey, keptWhen, readKept, writeKept } from '../../../../utils/localKeep';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Design with AI" in the map editor (D-001, D-005, D-015).
 *
 * Describe the room → the AI proposes sections and zones → THIS BROWSER places
 * them (`seatingLayout.js`) → the organizer sees what fits → Apply puts the
 * whole layout into the unsaved draft as ONE undo step. Nothing is saved
 * until they press Save, exactly as if they had drawn it.
 *
 * The plan is laid out the moment it arrives, before Apply, so the summary can
 * say "placed 38 of 42" while the organizer can still go back and ask for
 * smaller tables — not after their map has been replaced.
 *
 * THE LAST PLAN IS KEPT in this browser, per event (`localKeep.js`). It cost a
 * daily draft; closing the dialog, reloading, or undoing an applied layout
 * must not mean paying again to see it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const EXAMPLES = [
  '250 guests at round tables of 10. VIP tables at the front near the stage, a dance floor in the middle, a bar at the back.',
  'Wedding for 120: head table at the front, family tables on the left and right, a cake table and a photo booth.',
  'Conference talk: 12 rows of 20 chairs facing the stage, welcome desk at the entrance.',
];

export default function SeatingDesigner({
  eventId, tiers, categories, replacing, blocked = null, onApply, onClose, world,
}) {
  const ref = useRef(null);
  const { quota, setQuota } = useAiQuota();
  const [kept] = useState(() => readKept(keepKey('seating-plan', eventId), { maxAgeDays: 14 }));
  const [description, setDescription] = useState(() => kept?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(() => kept?.plan || null);
  const [madeAt, setMadeAt] = useState(() => kept?.at || null);

  useEffect(() => { ref.current?.focus(); }, []);
  // `stopEscape`: the editor underneath clears its selection on Escape too.
  useModal(ref, () => { if (!busy) onClose(); }, { stopEscape: true });

  // Laid out across the venue's own floor, however big it was made.
  const layout = useMemo(() => (plan ? layoutPlan(plan, { tiers, categories, world }) : null), [plan, tiers, categories, world]);
  const exhausted = quota && quota.remaining < 1;
  const tooShort = description.trim().length < 20;

  async function generate(e) {
    e.preventDefault();
    if (tooShort || exhausted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/ai/events/${eventId}/seating-plan`, {
        requestId: crypto.randomUUID(), description: description.trim(),
      }, { noRedirect: true });
      setPlan(data.plan);
      writeKept(keepKey('seating-plan', eventId), { plan: data.plan, description: description.trim() });
      setMadeAt(new Date().toISOString());
      if (data.quota) setQuota(data.quota);
    } catch (err) {
      setError(err);
      if (err?.code === 'AI_QUOTA_EXHAUSTED') setQuota((q) => ({ ...(q || {}), remaining: 0 }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="es-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="es-design-title"
        className="es-backdrop__panel es-backdrop__panel--wide fx-stack" onSubmit={generate}
      >
        <div className="fx-row items-center gap-2">
          <span className="es-ai-design__orb" aria-hidden="true"><NavIcon name="sparkle" size={18} /></span>
          <h2 id="es-design-title" className="text-lg">Design the room with AI</h2>
        </div>

        {blocked ? (
          <>
            <p className="es-ai-later"><NavIcon name="info" size={15} /> {blocked}</p>
            <div className="fx-row flex-wrap justify-end gap-2">
              <button type="button" className="es-btn es-btn--primary" onClick={onClose}>OK</button>
            </div>
          </>
        ) : !layout ? (
          <>
            <p className="text-sm text-muted">
              Describe the room and your guests. AI plans the sections; Eventsli places every table so nothing overlaps.
              Prices come only from your own ticket types.
            </p>
            <label className="fx-stack fx-stack--sm">
              <span className="text-sm font-medium text-ink">Your room</span>
              <textarea
                className="es-input min-h-32" rows={5} maxLength={1500} value={description}
                onChange={(e) => setDescription(e.target.value)} disabled={busy}
                placeholder="e.g. 200 guests, round tables of 10, VIP near the stage, dance floor in the middle, two bars at the back."
              />
            </label>
            <div className="fx-stack fx-stack--sm">
              <span className="text-xs text-subtle">Or start from an example:</span>
              <ul className="es-ai-design__examples">
                {EXAMPLES.map((ex) => (
                  <li key={ex}>
                    <button type="button" className="es-ai-design__example" onClick={() => setDescription(ex)} disabled={busy}>{ex}</button>
                  </li>
                ))}
              </ul>
            </div>
            {replacing && (
              <p className="es-ai-later"><NavIcon name="info" size={15} /> This replaces the tables and areas on your map. Undo brings them back.</p>
            )}
            <FormError error={error} />
            <div className="fx-row fx-row--between flex-wrap items-center gap-3">
              {exhausted ? <span className="text-sm text-muted">No AI drafts left today</span> : <QuotaDots quota={quota} />}
              <div className="fx-row gap-2">
                <button type="button" className="es-btn es-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="es-btn es-btn--primary" disabled={busy || tooShort || exhausted}>
                  {busy ? <><span className="es-ai-spin" aria-hidden="true" /> Planning…</> : <><NavIcon name="sparkle" size={16} /> Plan the room</>}
                </button>
              </div>
            </div>
          </>
        ) : (
          <PlanSummary
            plan={plan} layout={layout} madeAt={madeAt}
            onBack={() => setPlan(null)}
            onApply={() => { onApply(layout); onClose(); }}
          />
        )}
      </form>
    </div>
  );
}

/**
 * The way in, above the map rather than inside the toolbar: on a phone the
 * toolbar is folded away, and on a desktop one more small button among a
 * dozen is one nobody notices. An empty map gets the full invitation — it is
 * the moment describing the room saves the most work.
 */
export function DesignBanner({ empty, onOpen }) {
  return (
    <div className={`es-ai-designbar${empty ? ' es-ai-designbar--empty' : ''}`}>
      <span className="es-ai-design__orb" aria-hidden="true"><NavIcon name="sparkle" size={18} /></span>
      <div className="fx-min0 flex-1">
        <p className="font-medium text-ink">{empty ? 'Describe your room and AI lays it out' : 'Design the room with AI'}</p>
        <p className="text-sm text-muted">
          {empty
            ? 'Guests, table sizes, VIP near the stage, dance floor, bars — Eventsli places every table so nothing overlaps.'
            : 'Replace this layout with one planned from a description. Undo brings this one back.'}
        </p>
      </div>
      <button type="button" className={`es-btn ${empty ? 'es-btn--primary' : 'es-btn--secondary'} es-btn--sm`} onClick={onOpen}>
        <NavIcon name="sparkle" size={15} /> Design with AI
      </button>
    </div>
  );
}

function PlanSummary({ plan, layout, madeAt, onBack, onApply }) {
  const { report, zones } = layout;
  const short = report.wanted - report.placed;
  return (
    <>
      {madeAt && (
        <p className="text-xs text-subtle">
          Planned {keptWhen(madeAt)} and kept in this browser — applying it again costs nothing.
        </p>
      )}
      {plan.summary && <p className="text-sm text-muted">{plan.summary}</p>}
      <div className="es-ai-design__stats" role="status">
        <span><b className="es-nums">{report.placed}</b> tables</span>
        <span><b className="es-nums">{report.seats}</b> seats</span>
        <span><b className="es-nums">{zones.length}</b> areas</span>
      </div>
      <ul className="es-ai-design__sections">
        {report.sections.map((s) => (
          <li key={s.name}>
            <span className="fx-min0">
              <span className="block font-medium text-ink fx-break">{s.name}</span>
              <span className="block text-xs text-muted">
                {s.shape === 'row'
                  ? `${s.placed} row${s.placed === 1 ? '' : 's'} of ${s.seats} seats`
                  : `${s.placed} ${(SHAPE_NAMES[s.shape] || s.shape).toLowerCase()} table${s.placed === 1 ? '' : 's'} of ${s.seats}`}
                {s.ticketType ? ` · sold as “${s.ticketType}”` : ' · price it from the table panel'}
              </span>
            </span>
            {s.placed < s.wanted && <span className="es-ai-design__short">{s.placed} of {s.wanted}</span>}
          </li>
        ))}
      </ul>
      {zones.length > 0 && <p className="text-sm text-muted">Areas: {zones.map((z) => z.label || zoneMeta(z.kind).label).join(', ')}.</p>}
      {short > 0 && (
        <p className="es-ai-later">
          <NavIcon name="alert" size={15} />
          {short} table{short === 1 ? '' : 's'} didn&rsquo;t fit on the map. Go back and ask for larger tables or fewer of them, or add them by hand after applying.
        </p>
      )}
      {report.skippedZones.length > 0 && (
        <p className="es-ai-later"><NavIcon name="info" size={15} /> No room left for: {report.skippedZones.map((k) => zoneMeta(k).label).join(', ')}.</p>
      )}
      <div className="fx-row flex-wrap justify-end gap-2">
        <button type="button" className="es-btn es-btn--ghost" onClick={onBack}>Change the description</button>
        <button type="button" className="es-btn es-btn--primary" onClick={onApply}>Apply to map</button>
      </div>
      <p className="text-xs text-subtle">Applying is one step: Undo puts your previous map back. Nothing is saved until you press Save.</p>
    </>
  );
}
