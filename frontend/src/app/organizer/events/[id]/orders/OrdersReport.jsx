'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../../../../hooks/useModal';
import { messageFor } from '../../../../utils/errors';
import { PAPERS, PAPER_KEYS, paperBox } from '../map/print/packGeometry';
import { fetchAllOrders, summarize } from './ordersExport';
import { reportCss } from './ordersReportCss';
import OrdersReportDoc from './OrdersReportDoc';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SALES REPORT, READY TO SAVE AS PDF (2026-11-23).
 *
 * Owner's choice: a designed report the browser prints, not a PDF library.
 * The same argument as the seating pack — every browser already paginates,
 * honours `@page` and offers "Save as PDF" in the print dialog — plus one of
 * its own: buyers' names here are often Arabic, which JavaScript PDF writers
 * render as disconnected letters in the wrong order, and the browser gets
 * right with the brand's own fonts.
 *
 * Opens on the orders under the filters on screen, all of them (every page,
 * ordersExport.fetchAllOrders), and previews them on the chosen paper. US
 * Letter is the default in Canada and the US, where the product launched; A4
 * everywhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrdersReport({ eventId, event, filters, onClose }) {
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, rows: [], meta: null });
  const [paper, setPaper] = useState(() => (['CA', 'US'].includes(String(event?.country || '').toUpperCase()) ? 'letter' : 'a4'));
  const [orientation, setOrientation] = useState('portrait');

  useEffect(() => { closeRef.current?.focus(); }, []);
  useModal(rootRef, onClose, { stopEscape: true });

  // Bumped by "Try again"; the effect below refetches when it changes.
  const [attempt, setAttempt] = useState(0);

  // An async IIFE so every setState lands after an await (AGENTS.md), with a
  // `cancelled` guard so a late answer cannot land after the dialog closed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { rows, meta } = await fetchAllOrders(eventId, filters);
        if (!cancelled) setState({ loading: false, error: null, rows, meta });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err, rows: [], meta: null });
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, filters, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const summary = useMemo(() => summarize(state.rows, state.meta), [state.rows, state.meta]);
  const generated = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: event?.timezone || undefined, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date()), [event?.timezone]);

  const box = paperBox(paper, orientation);
  const footer = `Eventsli · Sales report · ${event?.title || ''}`;
  const ready = !state.loading && !state.error;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={rootRef} className="es-orep-root" role="dialog" aria-modal="true" aria-label="Sales report, ready to print or save as PDF">
      <style>{reportCss({ box, footer })}</style>

      <header className="es-orep-chrome fx-row fx-row--between flex-wrap gap-3 border-b border-border-base bg-surface px-4 py-3">
        <div className="fx-min0">
          <h2 className="text-lg">Sales report</h2>
          <p className="text-sm text-muted">
            {state.loading ? 'Gathering every order…' : state.error ? 'The orders did not load.' : `${state.rows.length} ${state.rows.length === 1 ? 'order' : 'orders'} · ${box.label} ${orientation}`}
          </p>
        </div>
        <div className="fx-row flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="es-orep-paper">Paper</label>
          <select id="es-orep-paper" className="es-input w-auto" value={paper} onChange={(e) => setPaper(e.target.value)}>
            {PAPER_KEYS.map((k) => <option key={k} value={k}>{PAPERS[k].label}</option>)}
          </select>
          <label className="sr-only" htmlFor="es-orep-orient">Orientation</label>
          <select id="es-orep-orient" className="es-input w-auto" value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <button type="button" className="es-btn es-btn--primary" onClick={() => window.print()} disabled={!ready}>
            Save as PDF
          </button>
          <button ref={closeRef} type="button" className="es-btn es-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="es-orep-scroll">
        {state.loading ? (
          <p className="es-orep-chrome py-16 text-center text-sm text-on-dark">Gathering every order…</p>
        ) : state.error ? (
          <div className="es-orep-chrome fx-stack mx-auto max-w-md items-center rounded-(--es-radius-lg) bg-surface p-6 text-center">
            <p className="text-ink">{messageFor(state.error)}</p>
            <button type="button" className="es-btn es-btn--primary" onClick={retry}>Try again</button>
          </div>
        ) : (
          <OrdersReportDoc event={event} rows={state.rows} summary={summary} filters={filters} generated={generated} />
        )}
      </div>
    </div>,
    document.body,
  );
}
