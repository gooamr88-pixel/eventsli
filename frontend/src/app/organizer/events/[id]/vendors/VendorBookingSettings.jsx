'use client';

import { Panel } from '../../../../components/ui/Page';
import Field from '../../../../components/forms/Field';
import NavIcon from '../../../../components/shell/NavIcon';
import ImageField from '../../../../components/vendors/booking/ImageField';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The booking half of the vendor page settings (2026-11-21): how vendors
 * book, what they upload, and what the public page shows them.
 *
 *   How vendors book   "Reserve and pay now" (a booth is held while they
 *                      fill their details, then paid) or "Apply, you approve"
 *   Documents          what every vendor must upload (licence, insurance…)
 *   Page highlights    up to three numbers of YOUR event ("80%" + a line)
 *   Page photos        up to three, fanned beside the numbers
 *
 * State lives in VendorProgram's form; this renders it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VendorBookingSettings({ eventId, value, onChange }) {
  const { bookingMode, holdMinutes, documents, highlights, photos } = value;
  const set = (patch) => onChange({ ...value, ...patch });
  const setDoc = (i, patch) => set({ documents: documents.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const setStat = (i, patch) => set({ highlights: highlights.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const base = `/events/${eventId}/vendors`;

  return (
    <>
      <Panel icon="store" title="How vendors book" description="Both start the same way: a vendor picks a booth and its add-ons, then adds their business details and documents.">
        <div className="es-vb-modes" role="radiogroup" aria-label="How vendors book">
          {[
            ['instant', 'Reserve and pay now', 'The booth is held while they fill in their details, then they sign and pay. Booked straight away — no review.', 'card'],
            ['apply', 'Apply, you approve', 'They send an application. You review it, then send an offer they accept and pay.', 'send'],
          ].map(([key, title, body, icon]) => (
            <label key={key} className={`es-vb-mode ${bookingMode === key ? 'is-on' : ''}`}>
              <input type="radio" name="vp-mode" value={key} checked={bookingMode === key} onChange={() => set({ bookingMode: key })} />
              <span className="es-vb-mode__icon" aria-hidden="true"><NavIcon name={icon} size={22} /></span>
              <span className="fx-min0">
                <b>{title}</b>
                <span className="block text-sm text-muted">{body}</span>
              </span>
            </label>
          ))}
        </div>
        {bookingMode === 'instant' && (
          <div className="fx-grid fx-grid--2 mt-3">
            <Field label="Hold a booth for (minutes)" name="vp-hold" type="number" min={10} max={60} required value={holdMinutes}
              onChange={(e) => set({ holdMinutes: e.target.value })}
              hint="How long a booth is kept for a vendor who is filling in their details. 10 to 60." />
          </div>
        )}
      </Panel>

      <Panel icon="fileText" title="Documents vendors upload" description="Kept private: only you and the vendor can open them. You approve or reject each one on the application.">
        <div className="fx-stack fx-stack--sm">
          {documents.length === 0 && <p className="text-sm text-muted">No documents asked for. Add things like “Food handler certificate” or “Liability insurance”.</p>}
          <ol className="es-vd-questions">
            {documents.map((d, i) => (
              <li key={d.id || i} className="es-vd-question">
                <input className="es-input es-input--sm" aria-label={`Document ${i + 1} name`} maxLength={80} placeholder="Liability insurance"
                  value={d.label} onChange={(e) => setDoc(i, { label: e.target.value })} />
                <input className="es-input es-input--sm" aria-label={`Document ${i + 1} note for vendors`} maxLength={160} placeholder="Note (optional)"
                  value={d.hint || ''} onChange={(e) => setDoc(i, { hint: e.target.value })} />
                <label className="fx-row items-center gap-1 text-sm">
                  <input type="checkbox" checked={d.required} onChange={(e) => setDoc(i, { required: e.target.checked })} />Required
                </label>
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-label={`Remove document ${i + 1}`}
                  onClick={() => set({ documents: documents.filter((_, j) => j !== i) })}><NavIcon name="trash" size={16} /></button>
              </li>
            ))}
          </ol>
          {documents.length < 8 && (
            <div className="fx-row">
              <button type="button" className="es-btn es-btn--secondary es-btn--sm"
                onClick={() => set({ documents: [...documents, { id: `d${Date.now().toString(36)}`, label: '', hint: '', required: true }] })}>
                <NavIcon name="plus" size={16} />Ask for a document
              </button>
            </div>
          )}
        </div>
      </Panel>

      <Panel icon="chart" title="Page highlights" description="Up to three numbers about your event, shown big on the vendor page. Use only figures you can stand behind.">
        <div className="fx-stack fx-stack--sm">
          {highlights.map((h, i) => (
            <div key={i} className="es-vb-statrow">
              <input className="es-input es-input--sm" aria-label={`Highlight ${i + 1} number`} maxLength={12} placeholder="80%"
                value={h.value} onChange={(e) => setStat(i, { value: e.target.value })} />
              <input className="es-input es-input--sm" aria-label={`Highlight ${i + 1} words`} maxLength={160} placeholder="of last year’s vendors sold out before noon."
                value={h.label} onChange={(e) => setStat(i, { label: e.target.value })} />
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" aria-label={`Remove highlight ${i + 1}`}
                onClick={() => set({ highlights: highlights.filter((_, j) => j !== i) })}><NavIcon name="trash" size={16} /></button>
            </div>
          ))}
          {highlights.length < 3 && (
            <div className="fx-row">
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => set({ highlights: [...highlights, { value: '', label: '' }] })}>
                <NavIcon name="plus" size={16} />Add a highlight
              </button>
            </div>
          )}
          <p className="text-xs text-subtle">With none, the page shows how many booths there are and what they start at. Write a *word* in the headline above to put it on a yellow highlight.</p>
        </div>
      </Panel>

      <Panel icon="image" title="Page photos" description="Up to three, fanned beside the highlights. Your stalls, the crowd, last year’s market. Without any, your event poster is used.">
        <div className="es-vb-photos">
          {[0, 1, 2].map((i) => (
            <ImageField key={i} base={base} label={`Photo ${i + 1}`} value={photos[i] || null}
              onChange={(img) => {
                const next = [...photos];
                if (img) next[i] = img; else next.splice(i, 1);
                set({ photos: next.filter(Boolean) });
              }} />
          ))}
        </div>
      </Panel>
    </>
  );
}
