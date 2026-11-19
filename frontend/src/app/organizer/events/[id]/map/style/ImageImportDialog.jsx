'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { post } from '../../../../../utils/apiClient';
import { messageFor, describeError } from '../../../../../utils/errors';
import { useModal } from '../../../../../hooks/useModal';
import { useAiQuota } from '../../../../../hooks/useAiQuota';
import NavIcon from '../../../../../components/shell/NavIcon';
import SeatMapCanvas from '../../../../../components/seating/SeatMapCanvas';
import { planToMap } from '../../../../../components/seating/imageImport';
import { tierPalette } from '../../../../../components/venue/venueModel';
import { keepKey, keptWhen, readKept, writeKept } from '../../../../../utils/localKeep';
import { QuotaDots } from '../../../new/ai/AiParts';
import { POSTER_ACCEPT, preparePoster } from '../../../new/ai/posterImage';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Import from a picture" in the Venue Builder (owner, 2026-11-19: "upload the
 * image of a seating map and AI apply it exactly").
 *
 * Choose a picture → the AI measures every table, seat, area, wall and door
 * (one Seating Designer use) → `planToMap` places them at the picture's own
 * proportions → the organizer sees the picture and the rebuilt map side by
 * side → Apply puts it into the unsaved draft as ONE undo step.
 *
 * The result is kept in this browser per event (like the designer's plan): it
 * cost a daily draft, and closing the dialog must not mean paying again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ImageImportDialog({ eventId, replacing, blocked = null, onApply, onClose }) {
  const ref = useRef(null);
  const input = useRef(null);
  const { quota, setQuota } = useAiQuota();
  const key = keepKey('seating-image', eventId);
  const [kept] = useState(() => readKept(key, { maxAgeDays: 14 }));
  const [picture, setPicture] = useState(null);
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState(() => kept?.plan || null);
  const [madeAt, setMadeAt] = useState(() => kept?.at || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { ref.current?.focus(); }, []);
  useModal(ref, () => { if (!busy) onClose(); }, { stopEscape: true });

  const map = useMemo(() => (plan ? planToMap(plan) : null), [plan]);
  const preview = useMemo(() => {
    if (!map) return null;
    const tables = map.tables.map((t, i) => ({ ...t, id: `img-${i}`, canBookWhole: false }));
    // Two colours alternate, as the seat dots usually do in a printed plan.
    const palette = tierPalette([{ id: 'a', priceCents: 2 }, { id: 'b', priceCents: 1 }], [], map.look);
    const seats = tables.flatMap((t) => Array.from({ length: t.seatCount }, (_, n) => ({
      id: `${t.id}-${n}`, tableId: t.id, number: String(n + 1), available: true, tierId: n % 2 ? 'b' : 'a',
    })));
    return { tables, seats, seatFill: (s) => palette.get(s.tierId) || null };
  }, [map]);

  const exhausted = quota && quota.remaining < 1;
  const visionOff = quota && quota.enabled && quota.poster === false;

  async function choose(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try { setPicture(await preparePoster(file)); } catch (err) { setError(err); }
  }

  async function read() {
    if (!picture || busy || exhausted) return;
    setBusy(true);
    setError(null);
    try {
      const data = await post(`/ai/events/${eventId}/seating-plan/from-image`, {
        requestId: crypto.randomUUID(),
        image: { mimeType: 'image/jpeg', data: picture.dataUrl },
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      // A whole floor plan is a long answer: the server allows the AI 53 s
      // (seatingFromImage.MAP_CLOCK), so the browser outwaits it.
      }, { noRedirect: true, timeoutMs: 65_000 });
      setPlan(data.plan);
      setMadeAt(new Date().toISOString());
      writeKept(key, { plan: data.plan });
      if (data.quota) setQuota(data.quota);
    } catch (err) {
      setError(err);
      if (err?.code === 'AI_QUOTA_EXHAUSTED') setQuota((q) => ({ ...(q || {}), remaining: 0 }));
    } finally {
      setBusy(false);
    }
  }

  const r = map?.report;

  return (
    <div className="es-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="es-import-title" className="es-backdrop__panel es-tpldialog es-imgimport">
        <div className="fx-row items-center gap-2">
          <span className="es-ai-design__orb" aria-hidden="true"><NavIcon name="image" size={18} /></span>
          <h2 id="es-import-title" className="text-lg">Import a seating map from a picture</h2>
        </div>

        {blocked ? (
          <>
            <p className="es-ai-later"><NavIcon name="info" size={15} /> {blocked}</p>
            <div className="fx-row justify-end"><button type="button" className="es-btn es-btn--primary" onClick={onClose}>OK</button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Upload a floor plan or seating chart — a drawing, a screenshot or a clear photo. AI measures every table,
              counts the seats on each side, and redraws the areas, walls and doors where they are in the picture.
            </p>

            <div className="es-imgimport__panes">
              <div className="es-imgimport__pane">
                <span className="es-imgimport__caption">Your picture</span>
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local data: URL, never fetched
                  <img src={picture.dataUrl} alt="The seating map you chose" className="es-imgimport__img" />
                ) : (
                  <button type="button" className="es-imgimport__drop" onClick={() => input.current?.click()} disabled={busy}>
                    <NavIcon name="image" size={28} />
                    <b>Choose a picture</b>
                    <small>JPEG, PNG or WebP. Straight-on and uncropped reads best.</small>
                  </button>
                )}
                <input ref={input} type="file" accept={POSTER_ACCEPT} className="sr-only" onChange={choose} tabIndex={-1} aria-label="Seating map picture" />
                {picture && (
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => input.current?.click()} disabled={busy}>Choose another</button>
                )}
              </div>

              <div className="es-imgimport__pane">
                <span className="es-imgimport__caption">
                  Rebuilt map{madeAt && plan ? ` · read ${keptWhen(madeAt)}` : ''}
                </span>
                {preview ? (
                  <SeatMapCanvas
                    // A new reading is a new map: framed afresh even if the
                    // last one was zoomed (the map no longer re-frames itself
                    // once moved).
                    key={madeAt || 'kept'}
                    className="h-[24rem]"
                    tables={preview.tables} seats={preview.seats} zones={map.zones} world={map.world} look={map.look}
                    seatFill={preview.seatFill} showcase purchaseMode="seat_only" onSelectSeat={() => {}}
                  />
                ) : (
                  <div className="es-imgimport__empty">
                    {busy ? <><span className="es-ai-spin" aria-hidden="true" /> Measuring the tables and counting seats… This can take up to a minute for a large room.</> : 'The map appears here once the picture is read.'}
                  </div>
                )}
              </div>
            </div>

            {r && (
              <p className="text-sm text-ink" role="status">
                Read {r.tables} table{r.tables === 1 ? '' : 's'} with {r.seats.toLocaleString('en')} seats,
                {' '}{r.areas} area{r.areas === 1 ? '' : 's'}, {r.walls} wall{r.walls === 1 ? '' : 's'} and {r.doors} door{r.doors === 1 ? '' : 's'}.
                {r.cut ? ` ${r.cut} more tables were left out: a map holds 400.` : ''}
                {' '}Compare the two, then fix anything by hand after applying — ticket types are yours to assign.
              </p>
            )}

            <label className="fx-stack fx-stack--sm">
              <span className="text-sm font-medium text-ink">Anything the picture doesn’t show (optional)</span>
              <input className="es-input" maxLength={500} value={notes} disabled={busy}
                placeholder="e.g. Tables S36–S40 seat 4, the kitchen is staff only" onChange={(e) => setNotes(e.target.value)} />
            </label>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {describeError(error).title}. {messageFor(error)}
                {/* Why every AI provider failed (the API's own code, e.g.
                    AI_TIMEOUT or AI_REQUEST_REJECTED): "did not answer in
                    time" is said for all of them, so support needs this. */}
                {error.meta?.reason && <span className="fx-break block text-xs text-subtle">Reason: {error.meta.reason}</span>}
              </p>
            )}
            {visionOff && <p className="es-ai-later"><NavIcon name="info" size={15} /> Reading pictures is switched off right now.</p>}
            {replacing && plan && (
              <p className="es-ai-later"><NavIcon name="info" size={15} /> Applying replaces the tables and areas on your map. Undo brings them back, and nothing is saved until Save map.</p>
            )}

            <div className="fx-row fx-row--between flex-wrap items-center gap-3">
              {exhausted ? <span className="text-sm text-muted">No AI drafts left today</span> : <QuotaDots quota={quota} />}
              <div className="fx-row flex-wrap gap-2">
                <button type="button" className="es-btn es-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="es-btn es-btn--secondary" onClick={read} disabled={!picture || busy || exhausted || visionOff}>
                  {busy ? <><span className="es-ai-spin" aria-hidden="true" /> Reading…</> : <><NavIcon name="sparkle" size={16} /> {plan ? 'Read again' : 'Read the map'}</>}
                </button>
                <button type="button" className="es-btn es-btn--primary" disabled={!map || busy} onClick={() => onApply(map)}>
                  Apply to my map
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
