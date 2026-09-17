'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Panel } from '../../../../components/ui/Page';
import { Loading, Empty } from '../../../../components/Feedback';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { useContentSection, uploadImage, IMAGE_ACCEPT } from './useContentSection';
import RowControls from './RowControls';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sponsors and partners.
 *
 * LEVEL IS THE PRIMARY SORT, and the arrows only order within one. A headline
 * sponsor appearing below a partner is the single arrangement mistake that
 * causes a real conversation with a real sponsor, so it is made impossible
 * rather than left to the organizer to notice. The server sorts by level first
 * for the same reason.
 *
 * A LOGO IS OPTIONAL. Demanding artwork blocks the organizer who has a
 * confirmed sponsor and no file yet, and a name in clean type reads better than
 * a placeholder box anyway.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const LEVELS = [
  ['headline', 'Headline'],
  ['gold', 'Gold'],
  ['silver', 'Silver'],
  ['bronze', 'Bronze'],
  ['partner', 'Partner'],
];

export default function SponsorsEditor({ eventId }) {
  const { items, error, busy, add, edit, remove, move, setError } = useContentSection(eventId, 'sponsors');
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState({ name: '', linkUrl: '', level: 'partner' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const input = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        level: draft.level,
        ...(draft.linkUrl.trim() ? { linkUrl: draft.linkUrl.trim() } : {}),
      };
      if (file) body.path = await uploadImage(eventId, file, 'sponsor');

      const { ok } = await add(body);
      if (ok) {
        setDraft({ name: '', linkUrl: '', level: 'partner' });
        setFile(null);
        if (input.current) input.current.value = '';
        toast.success(`${body.name} added.`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function replaceLogo(sponsor, chosen) {
    if (!chosen) return;
    setError(null);
    try {
      const path = await uploadImage(eventId, chosen, 'sponsor');
      await edit(sponsor.id, { path });
      toast.success('Logo updated.');
    } catch (err) {
      setError(err);
    }
  }

  async function removeSponsor(sponsor) {
    const ok = await confirm({
      title: `Remove ${sponsor.name}?`,
      tone: 'danger',
      body: <p>They come off your event page straight away, and their logo file is deleted.</p>,
      confirmLabel: 'Remove sponsor',
    });
    if (ok) remove(sponsor.id);
  }

  return (
    <Panel
      title="Sponsors & partners"
      description="Shown near the bottom of your event page, grouped by level. Optional — add them only if you have them."
    >
      <FormError error={error} />

      {items === null ? (
        <Loading variant="list" rows={2} label="Loading sponsors" />
      ) : items.length === 0 ? (
        <Empty title="No sponsors yet" hint="Add the ones you have. The section is hidden on your event page until then." />
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {items.map((sponsor, index) => (
            <li key={sponsor.id} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base p-3">
              <div className="fx-row flex-wrap items-center gap-3">
                <div className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-(--es-radius-sm) bg-bg-sunken">
                  {sponsor.logoUrl ? (
                    <Image src={sponsor.logoUrl} alt="" width={80} height={48} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs text-subtle">No logo</span>
                  )}
                </div>

                <div className="fx-min0 flex-1">
                  <input
                    className="es-input es-input--sm"
                    defaultValue={sponsor.name}
                    maxLength={120}
                    aria-label={`Name of ${sponsor.name}`}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== sponsor.name) edit(sponsor.id, { name: next });
                    }}
                  />
                </div>

                <select
                  className="es-input es-input--sm w-auto"
                  value={sponsor.level}
                  aria-label={`Sponsorship level for ${sponsor.name}`}
                  onChange={(e) => edit(sponsor.id, { level: e.target.value })}
                >
                  {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <input
                className="es-input es-input--sm"
                type="url"
                inputMode="url"
                defaultValue={sponsor.linkUrl || ''}
                placeholder="https://sponsor.example"
                aria-label={`Website for ${sponsor.name}`}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (sponsor.linkUrl || '')) edit(sponsor.id, { linkUrl: next || null });
                }}
              />

              <div className="fx-row flex-wrap items-center gap-2">
                <input
                  id={`sponsor-logo-${sponsor.id}`}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  onChange={(e) => replaceLogo(sponsor, e.target.files?.[0])}
                />
                <label htmlFor={`sponsor-logo-${sponsor.id}`} className="es-btn es-btn--ghost es-btn--sm">
                  {sponsor.logoUrl ? 'Replace logo' : 'Add logo'}
                </label>
              </div>

              <RowControls
                index={index}
                total={items.length}
                busy={busy}
                label="sponsor"
                onMove={(delta) => move(sponsor.id, delta)}
                onRemove={() => removeSponsor(sponsor)}
              />
              <p className="text-xs text-subtle">
                The arrows order sponsors within their level. Levels always come headline first.
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="fx-stack fx-stack--sm border-t border-border-base pt-4">
        <div className="fx-grid" style={{ '--fx-col': '200px', '--fx-gap': '10px' }}>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">Sponsor name</span>
            <input
              className="es-input" required maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">Website (optional)</span>
            <input
              className="es-input" type="url" inputMode="url"
              placeholder="https://"
              value={draft.linkUrl}
              onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
            />
          </label>
          <label className="fx-stack fx-stack--sm gap-1">
            <span className="text-sm text-ink">Level</span>
            <select
              className="es-input"
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            >
              {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        <div className="fx-row flex-wrap items-center gap-2">
          <input
            ref={input}
            id={`sponsor-new-${eventId}`}
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <label htmlFor={`sponsor-new-${eventId}`} className="es-btn es-btn--ghost es-btn--sm">
            {file ? 'Logo chosen' : 'Choose a logo (optional)'}
          </label>
          {file && <span className="text-xs text-subtle">{file.name}</span>}
        </div>

        <button type="submit" disabled={saving || busy || !draft.name.trim()} className="es-btn es-btn--secondary self-start">
          {saving ? 'Adding…' : 'Add sponsor'}
        </button>
      </form>
    </Panel>
  );
}
